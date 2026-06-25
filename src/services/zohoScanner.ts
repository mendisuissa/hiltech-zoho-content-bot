import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type {
  ApprovalRequest,
  ContentAudience,
  ContentCategory,
  SourceConfig,
  SourceItem,
  SourceProduct,
} from '@prisma/client';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { normalizeCanonicalUrl, upsertSourceItem } from './dedupeService';
import { randomToken, sha256, normalizeWhitespace } from '../utils/hash';
import { scoreZohoItem } from './scoringService';
import { shouldGenerateContent, generateContentPack } from './contentGenerator';
import { assessContentQuality, qualityScore, buildRewriteInstructions } from './qualityService';
import { createEditorialBrief, normalizeEditorialBrief } from './editorialService';
import { sendApprovalNotification } from './telegramService';
import { sourceConfigs } from '../config/sources';

export type ScanResult = {
  sourcesProcessed: number;
  candidatesFound: number;
  itemsStored: number;
  approvalsCreated: number;
  skipped: number;
};

type ParsedCandidate = {
  title: string;
  canonicalUrl: string;
  summary: string;
  bodyText: string;
  publishedAt?: Date | null;
};

type CandidateLink = {
  title: string;
  url: string;
  publishedAt?: Date | null;
};

function pickText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const element = $(selector).first();
    const text = element.attr('content') ?? element.text().trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function collectBodyText($: cheerio.CheerioAPI): string {
  const candidates = ['article', 'main', '[role="main"]', '.content', '.main-content', 'body'];
  for (const selector of candidates) {
    const text = $(selector)
      .find('p,li,h1,h2,h3,h4')
      .map((_, element) => $(element).text())
      .get()
      .join(' ');
    const normalized = normalizeWhitespace(text);
    if (normalized.length > 120) {
      return normalized;
    }
  }
  return normalizeWhitespace($('body').text());
}

function extractCanonicalUrl($: cheerio.CheerioAPI, fallbackUrl: string): string {
  const canonical =
    $('link[rel="canonical"]').attr('href') ||
    $('meta[property="og:url"]').attr('content') ||
    fallbackUrl;
  return normalizeCanonicalUrl(new URL(canonical, fallbackUrl).toString());
}

function parseOfficialDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const normalized = normalizeWhitespace(value).replace(/\s+/g, ' ').trim();
  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;

  const monthYear = normalized.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (monthYear) {
    const parsed = new Date(`${monthYear[1]} 1, ${monthYear[2]} 12:00:00 UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const iso = normalized.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]([0-3]?\d))?\b/);
  if (iso) {
    const parsed = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3] ?? 1)));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function extractJsonLdDates($: cheerio.CheerioAPI): Date[] {
  const dates: Date[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        for (const key of ['datePublished', 'dateModified', 'uploadDate']) {
          const date = parseOfficialDate(typeof record[key] === 'string' ? record[key] : undefined);
          if (date) dates.push(date);
        }
        for (const nested of Object.values(record)) visit(nested);
      };
      visit(parsed);
    } catch {
      // Ignore malformed JSON-LD and continue with other official page signals.
    }
  });
  return dates;
}

function extractPublishedAt($: cheerio.CheerioAPI): Date | null {
  const values = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="article:published_time"]').attr('content'),
    $('meta[property="og:updated_time"]').attr('content'),
    $('time[datetime]').first().attr('datetime'),
    $('meta[name="date"]').attr('content'),
    $('meta[name="publish-date"]').attr('content'),
  ].filter(Boolean) as string[];

  for (const value of values) {
    const parsed = parseOfficialDate(value);
    if (parsed) return parsed;
  }

  const jsonLdDate = extractJsonLdDates($).sort((a, b) => b.getTime() - a.getTime())[0];
  if (jsonLdDate) return jsonLdDate;

  const pageText = normalizeWhitespace($('main, article, body').first().text()).slice(0, 6000);
  const textual = parseOfficialDate(pageText);
  return textual;
}


async function fetchPage(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'HilTech Zoho Content Bot/1.0',
    },
  });
  return response.data as string;
}

async function parseCandidatePage(url: string, fallbackTitle: string, fallbackPublishedAt?: Date | null): Promise<ParsedCandidate> {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const title = pickText($, ['meta[property="og:title"]', 'title', 'h1']) || fallbackTitle || url;
  const canonicalUrl = extractCanonicalUrl($, url);
  const bodyText = collectBodyText($);
  const summary =
    pickText($, ['meta[name="description"]', 'meta[property="og:description"]']) ||
    bodyText.slice(0, 320) ||
    fallbackTitle;
  return {
    title: normalizeWhitespace(title),
    canonicalUrl,
    summary: normalizeWhitespace(summary),
    bodyText: normalizeWhitespace(bodyText),
    publishedAt: extractPublishedAt($) ?? fallbackPublishedAt ?? null,
  };
}

function extractCardDate($: cheerio.CheerioAPI, element: Element): Date | null {
  const card = $(element).closest('article, li, .blog-card, .post, .card, .item, div').first();
  const text = normalizeWhitespace(card.text());
  return parseOfficialDate(text);
}

async function collectCandidatesFromSource(source: SourceConfig): Promise<CandidateLink[]> {
  const html = await fetchPage(source.url);
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: CandidateLink[] = [];

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    let absolute: URL;
    try { absolute = new URL(href, source.url); } catch { return; }
    if (!['www.zoho.com', 'zoho.com'].includes(absolute.hostname.toLowerCase())) return;
    const path = absolute.pathname.toLowerCase();
    if (!path.includes(`/${source.product === 'projects' ? 'projects' : source.product}/`)) return;
    if (/login|signup|pricing|support|contact|help|terms|privacy/i.test(absolute.toString())) return;
    const normalized = normalizeCanonicalUrl(absolute.toString());
    if (seen.has(normalized)) return;
    const text = normalizeWhitespace($(element).text());
    if (text.length < 8) return;
    seen.add(normalized);
    candidates.push({ title: text.slice(0, 220), url: normalized, publishedAt: extractCardDate($, element) });
  });

  if (candidates.length === 0) {
    const fallbackTitle = pickText($, ['meta[property="og:title"]', 'title', 'h1']) || source.name;
    candidates.push({
      title: normalizeWhitespace(fallbackTitle),
      url: normalizeCanonicalUrl(source.url),
      publishedAt: extractPublishedAt($),
    });
  }

  // Prefer cards that include an explicit 2026+ date and process recent entries first.
  return candidates
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, 35);
}


async function processCandidate(
  source: SourceConfig,
  candidate: CandidateLink,
): Promise<{
  sourceItem?: SourceItem;
  approvalRequest?: ApprovalRequest;
  createdApproval: boolean;
  skipped: boolean;
}> {
  const parsed = await parseCandidatePage(candidate.url, candidate.title, candidate.publishedAt);
  // HilTech publishes only current Zoho updates. A date must be present in the
  // official source and it must be from 2026 onward; undated pages are not sent
  // for approval because their recency cannot be verified.
  const publicationYear = parsed.publishedAt?.getUTCFullYear();
  if (!publicationYear || publicationYear < 2026) {
    logger.info('Skipping non-current or undated Zoho item', {
      source: source.name,
      url: parsed.canonicalUrl,
      publishedAt: parsed.publishedAt?.toISOString() ?? null,
      eligible: false,
    });
    return { skipped: true, createdApproval: false };
  }

  logger.info('Eligible official Zoho update detected', {
    source: source.name,
    title: parsed.title,
    detectedDate: parsed.publishedAt?.toISOString(),
    eligible: true,
  });

  const relevance = scoreZohoItem({
    title: parsed.title,
    summary: parsed.summary,
    bodyText: parsed.bodyText,
    product: source.product as SourceProduct,
  });

  if (!shouldGenerateContent(relevance.category)) {
    return { skipped: true, createdApproval: false };
  }

  const contentHash = sha256(
    normalizeWhitespace(
      `${parsed.title}\n${parsed.summary}\n${parsed.bodyText}\n${parsed.canonicalUrl}`,
    ).toLowerCase(),
  );

  const sourceItem = await upsertSourceItem({
    sourceConfig: { connect: { id: source.id } },
    title: parsed.title,
    canonicalUrl: parsed.canonicalUrl,
    contentHash,
    summary: parsed.summary,
    bodyText: parsed.bodyText,
    publishedAt: parsed.publishedAt ?? undefined,
    relevanceScore: relevance.score,
    category: relevance.category as ContentCategory,
    audience: relevance.audience as ContentAudience,
  });

  const existingApproval = await prisma.approvalRequest.findUnique({
    where: { sourceItemId: sourceItem.id },
  });
  if (existingApproval) {
    return { sourceItem, approvalRequest: existingApproval, createdApproval: false, skipped: false };
  }

  const editorialBrief = normalizeEditorialBrief(
    await createEditorialBrief(source, sourceItem),
    sourceItem.audience,
    sourceItem.category,
  );
  if (!editorialBrief.recommended || editorialBrief.category === 'skip') {
    return { sourceItem, createdApproval: false, skipped: true };
  }

  let contentPack = await generateContentPack(source, sourceItem, editorialBrief);
  let qualityReport = await assessContentQuality({ source, item: sourceItem, editorialBrief, content: contentPack });
  let rewriteCount = 0;
  if (qualityReport.status === 'rewrite_required') {
    rewriteCount = 1;
    contentPack = await generateContentPack(source, sourceItem, editorialBrief, buildRewriteInstructions(qualityReport));
    qualityReport = await assessContentQuality({ source, item: sourceItem, editorialBrief, content: contentPack });
  }

  const approvalTitle = contentPack.articleDraft.raw.title || editorialBrief.hebrewTitle || sourceItem.title;

  const approvalRequest = await prisma.approvalRequest.create({
    data: {
      sourceItemId: sourceItem.id,
      approvalToken: randomToken(16),
      title: approvalTitle,
      canonicalUrl: sourceItem.canonicalUrl,
      sourceUrl: source.url,
      relevanceScore: sourceItem.relevanceScore,
      category: sourceItem.category,
      audience: sourceItem.audience,
      articleDraft: contentPack.articleDraft.raw,
      facebookPageDraft: contentPack.facebookPageDraft.raw,
      facebookGroupDraft: contentPack.facebookGroupDraft.raw,
      whatsappDraft: contentPack.whatsappDraft.raw,
      coverDraft: contentPack.coverDraft.raw,
      qualityScore: qualityScore(qualityReport),
      qualityReport,
      editorialBrief,
      qualityStatus: qualityReport.status,
      rewriteCount,
    },
  });

  await sendApprovalNotification(approvalRequest, sourceItem);

  return { sourceItem, approvalRequest, createdApproval: true, skipped: false };
}

export async function seedSourceConfigs(): Promise<void> {
  for (const source of sourceConfigs) {
    await prisma.sourceConfig.upsert({
      where: { slug: source.slug },
      update: {
        name: source.name,
        url: source.url,
        product: source.product,
        active: true,
      },
      create: {
        slug: source.slug,
        name: source.name,
        url: source.url,
        product: source.product,
        active: true,
      },
    });
  }
}

export async function runZohoScan(): Promise<ScanResult> {
  await seedSourceConfigs();
  const sources = await prisma.sourceConfig.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  });

  const result: ScanResult = {
    sourcesProcessed: 0,
    candidatesFound: 0,
    itemsStored: 0,
    approvalsCreated: 0,
    skipped: 0,
  };

  for (const source of sources) {
    result.sourcesProcessed += 1;
    logger.info('Scanning source', { source: source.name, url: source.url });
    let candidates: CandidateLink[] = [];
    try {
      candidates = await collectCandidatesFromSource(source);
    } catch (error) {
      logger.error('Failed to collect candidates', { source: source.name, error });
      continue;
    }

    result.candidatesFound += candidates.length;

    for (const candidate of candidates) {
      try {
        const { sourceItem, approvalRequest, createdApproval, skipped } = await processCandidate(
          source,
          candidate,
        );
        if (skipped) {
          result.skipped += 1;
          continue;
        }
        if (sourceItem) {
          result.itemsStored += 1;
        }
        if (createdApproval && approvalRequest) {
          result.approvalsCreated += 1;
        }
      } catch (error) {
        logger.error('Failed to process candidate', {
          source: source.name,
          candidate: candidate.url,
          error,
        });
      }
    }
  }

  return result;
}

export async function getPendingApprovals() {
  return prisma.approvalRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    include: {
      sourceItem: {
        include: {
          sourceConfig: true,
        },
      },
    },
  });
}
