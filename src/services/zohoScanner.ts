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
  summary?: string;
  bodyText?: string;
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

async function parseCandidatePage(
  url: string,
  fallbackTitle: string,
  fallbackPublishedAt?: Date | null,
  fallbackSummary?: string,
  fallbackBodyText?: string,
): Promise<ParsedCandidate> {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const pageTitle = pickText($, ['meta[property="og:title"]', 'title', 'h1']);
  const title = fallbackTitle || pageTitle || url;
  const canonicalUrl = extractCanonicalUrl($, url);
  const pageBodyText = collectBodyText($);
  const bodyText = normalizeWhitespace([fallbackBodyText, pageBodyText].filter(Boolean).join(' '));
  const summary =
    fallbackSummary ||
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

function parseMonthYearNearText(value: string): Date | null {
  const normalized = normalizeWhitespace(value);
  const monthYear = normalized.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i,
  );
  if (monthYear) return parseOfficialDate(`${monthYear[1]} 1, ${monthYear[2]}`);
  const yearMonth = normalized.match(
    /\b(20\d{2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  );
  if (yearMonth) return parseOfficialDate(`${yearMonth[2]} 1, ${yearMonth[1]}`);
  return parseOfficialDate(normalized);
}

function isOfficialZohoHost(hostname: string): boolean {
  return ['www.zoho.com', 'zoho.com', 'help.zoho.com', 'blog.zoho.com'].includes(hostname.toLowerCase());
}

function isOfficialUpdateLink(source: SourceConfig, absolute: URL): boolean {
  const hostname = absolute.hostname.toLowerCase();
  const path = absolute.pathname.toLowerCase();

  // The current Zoho Projects What’s New page stores the update title and date
  // on the timeline page, while the official Read More links often point to
  // help.zoho.com. Treat those Help articles as official source links.
  if (source.product === 'projects') {
    if (hostname === 'help.zoho.com') return path.includes('/portal/');
    if (hostname === 'blog.zoho.com') return path.includes('projects') || path.includes('project');
    return (path.startsWith('/projects/') || path.startsWith('/blog/projects/')) && !/projects\d+\.html$/.test(path);
  }
  if (source.product === 'crm') {
    if (hostname === 'help.zoho.com') return path.includes('/portal/');
    return path.startsWith('/crm/') || path.startsWith('/crm/whats-new/');
  }
  if (hostname === 'help.zoho.com') return path.includes('/portal/');
  return path.startsWith('/desk/') || path.startsWith('/desk/release-notes/');
}

function nearestTimelineDate($: cheerio.CheerioAPI, anchor: Element): Date | null {
  // Zoho What’s New pages frequently render a timeline with the year/month
  // outside the individual update card. Walk backwards through meaningful
  // ancestors and siblings so "May 2026" is inherited by the cards below it.
  let cursor = $(anchor);
  for (let level = 0; level < 7; level += 1) {
    const container = cursor.parent();
    if (!container.length) break;

    const ownText = normalizeWhitespace(container.clone().children('h1,h2,h3,h4,h5,h6,time,.date,.month,.year').text());
    const ownDate = parseMonthYearNearText(ownText);
    if (ownDate) return ownDate;

    const previous = container.prevAll().slice(0, 12);
    for (const sibling of previous.toArray()) {
      const siblingText = normalizeWhitespace($(sibling).text());
      const candidate = parseMonthYearNearText(siblingText);
      if (candidate) return candidate;
    }

    // Some layouts keep a date heading as the first child of a wrapper. Search
    // only direct headings/labels here, not every link in the page.
    const directLabels = container.children('h1,h2,h3,h4,h5,h6,time,.date,.month,.year');
    for (const label of directLabels.toArray()) {
      const candidate = parseMonthYearNearText($(label).text());
      if (candidate) return candidate;
    }

    cursor = container;
  }
  return null;
}

function extractCardDate($: cheerio.CheerioAPI, element: Element): Date | null {
  const card = $(element).closest('article, li, .blog-card, .post, .card, .item, [class*="update"], [class*="release"]').first();
  const cardText = normalizeWhitespace(card.text());
  return parseMonthYearNearText(cardText) ?? nearestTimelineDate($, element);
}

function isLikelyUpdateAnchor($: cheerio.CheerioAPI, element: Element): boolean {
  const text = normalizeWhitespace($(element).text());
  const href = $(element).attr('href') ?? '';
  if (text.length < 8 || text.length > 260) return false;
  if (/^(read more|learn more|click here|view all)$/i.test(text)) return false;
  if (/login|signup|pricing|support|contact|help|terms|privacy/i.test(href)) return false;
  // The current update cards normally live in an update/timeline/release area.
  // We still allow a dated card even when its class naming changes.
  const context = normalizeWhitespace($(element).closest('article, li, section, div').attr('class') ?? '');
  const dated = Boolean(extractCardDate($, element));
  return dated || /update|release|timeline|what.?s.?new|news|feature/i.test(context);
}


const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function monthIndex(value: string): number | null {
  const key = normalizeWhitespace(value).toLowerCase().replace(/[^a-z]/g, '');
  return Object.prototype.hasOwnProperty.call(MONTHS, key) ? MONTHS[key] : null;
}

function dateFromYearMonth(year: number | null, month: string | null): Date | null {
  if (!year || !month) return null;
  const monthNumber = monthIndex(month);
  if (monthNumber === null) return null;
  return new Date(Date.UTC(year, monthNumber, 1, 12, 0, 0));
}

function headingLevel(tagName: string): number {
  const match = tagName.toLowerCase().match(/^h([1-6])$/);
  return match ? Number(match[1]) : 99;
}

function looksLikeYear(text: string): number | null {
  const match = normalizeWhitespace(text).match(/^(20\d{2})$/);
  return match ? Number(match[1]) : null;
}

function looksLikeMonth(text: string): string | null {
  const normalized = normalizeWhitespace(text).replace(/[^A-Za-z]/g, '');
  return monthIndex(normalized) !== null ? normalized : null;
}

function titleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || sha256(title).slice(0, 16);
}

function collectFollowingUpdateContent($: cheerio.CheerioAPI, heading: Element): { summary: string; url: string | null; category: string | null } {
  const startLevel = headingLevel(heading.tagName ?? 'h4');
  const summaryParts: string[] = [];
  let category: string | null = null;
  let url: string | null = null;

  // Walk through the next elements in document order until the next same-or-higher
  // heading. This matches Zoho Projects, where each update is rendered as:
  // h4 title -> category text -> description -> Read More link.
  let cursor = $(heading).next();
  let guard = 0;
  while (cursor.length && guard < 80) {
    guard += 1;
    const node = cursor.get(0) as Element | undefined;
    if (!node) break;
    const tagName = (node.tagName ?? '').toLowerCase();
    const text = normalizeWhitespace(cursor.text());

    if (/^h[1-6]$/.test(tagName) && headingLevel(tagName) <= startLevel) {
      break;
    }

    if (!category && /^(New|Enhancements?|Mobile App|Blogs?)$/i.test(text)) {
      category = text;
    } else if (tagName === 'a') {
      const href = cursor.attr('href');
      const linkText = normalizeWhitespace(cursor.text());
      if (!url && href && /read more|learn more|more/i.test(linkText)) {
        url = href;
      }
    } else if (text && text.length > 35 && !summaryParts.includes(text)) {
      summaryParts.push(text);
    }

    // Also inspect links inside wrapper nodes, because some Zoho cards wrap the
    // Read More anchor inside a div rather than making it a direct sibling.
    if (!url) {
      const nestedReadMore = cursor.find('a[href]').filter((_, anchor) => /read more|learn more|more/i.test(normalizeWhitespace($(anchor).text()))).first();
      const nestedHref = nestedReadMore.attr('href');
      if (nestedHref) url = nestedHref;
    }

    cursor = cursor.next();
  }

  return {
    summary: normalizeWhitespace(summaryParts.join(' ')).slice(0, 900),
    url,
    category,
  };
}

function collectProjectsTimelineCandidatesFromHtml(html: string, sourceUrl: string, sourceName = 'Zoho Projects'): CandidateLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: CandidateLink[] = [];
  let currentYear: number | null = null;
  let currentMonth: string | null = null;

  $('h1,h2,h3,h4,h5,h6').each((_, rawHeading) => {
    const heading = rawHeading as Element;
    const tagName = (heading.tagName ?? '').toLowerCase();
    const text = normalizeWhitespace($(heading).text());
    if (!text) return;

    const year = looksLikeYear(text);
    if (year) {
      currentYear = year;
      currentMonth = null;
      return;
    }

    const month = looksLikeMonth(text);
    if (month && currentYear) {
      currentMonth = month;
      return;
    }

    const publishedAt = dateFromYearMonth(currentYear, currentMonth);
    if (!publishedAt || publishedAt.getUTCFullYear() < 2026) return;
    if (!/^h[4-6]$/.test(tagName)) return;
    if (text.length < 4 || text.length > 180) return;
    if (/^(timeline|all|blogs|enhancements?|mobile app|new)$/i.test(text)) return;

    const content = collectFollowingUpdateContent($, heading);
    if (/^Blogs?$/i.test(content.category ?? '')) return;
    if (!content.summary || content.summary.length < 40) return;

    let absoluteUrl: string;
    try {
      absoluteUrl = content.url ? new URL(content.url, sourceUrl).toString() : `${sourceUrl}#${titleSlug(text)}`;
    } catch {
      absoluteUrl = `${sourceUrl}#${titleSlug(text)}`;
    }

    const parsedUrl = new URL(absoluteUrl);
    if (!isOfficialZohoHost(parsedUrl.hostname)) return;
    if (!isOfficialUpdateLink({ product: 'projects', name: sourceName } as SourceConfig, parsedUrl)) return;

    const normalizedUrl = normalizeCanonicalUrl(absoluteUrl);
    if (seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);

    const categorySuffix = content.category ? ` (${content.category})` : '';
    candidates.push({
      title: normalizeWhitespace(`${text}${categorySuffix}`).slice(0, 220),
      url: normalizedUrl,
      summary: content.summary,
      bodyText: normalizeWhitespace(`${text}. ${content.category ?? ''}. ${content.summary}`),
      publishedAt,
    });
  });

  return candidates.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}

async function collectCandidatesFromSource(source: SourceConfig): Promise<CandidateLink[]> {
  const html = await fetchPage(source.url);

  if (source.product === 'projects') {
    const projectsCandidates = collectProjectsTimelineCandidatesFromHtml(html, source.url, source.name);
    logger.info('Zoho Projects timeline cards parsed', {
      source: source.name,
      collected: projectsCandidates.length,
      eligible2026: projectsCandidates.filter((candidate) => (candidate.publishedAt?.getUTCFullYear() ?? 0) >= 2026).length,
      samples: projectsCandidates.slice(0, 8).map((item) => ({
        title: item.title,
        date: item.publishedAt?.toISOString() ?? null,
        url: item.url,
      })),
    });
    return projectsCandidates.slice(0, 25);
  }

  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: CandidateLink[] = [];

  $('a[href]').each((_, element) => {
    if (!isLikelyUpdateAnchor($, element)) return;
    const href = $(element).attr('href');
    if (!href) return;

    let absolute: URL;
    try {
      absolute = new URL(href, source.url);
    } catch {
      return;
    }

    if (!isOfficialZohoHost(absolute.hostname)) return;
    if (!isOfficialUpdateLink(source, absolute)) return;

    const normalized = normalizeCanonicalUrl(absolute.toString());
    if (normalized === normalizeCanonicalUrl(source.url) || seen.has(normalized)) return;

    const title = normalizeWhitespace($(element).text());
    const publishedAt = extractCardDate($, element);
    seen.add(normalized);
    candidates.push({ title: title.slice(0, 220), url: normalized, publishedAt });
  });

  const eligible = candidates
    .filter((candidate) => (candidate.publishedAt?.getUTCFullYear() ?? 0) >= 2026)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  logger.info('Zoho source timeline candidates resolved', {
    source: source.name,
    collected: candidates.length,
    eligible2026: eligible.length,
    samples: eligible.slice(0, 5).map((item) => ({
      title: item.title,
      date: item.publishedAt?.toISOString() ?? null,
      url: item.url,
    })),
  });

  return eligible.slice(0, 25);
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
  const parsed = await parseCandidatePage(
    candidate.url,
    candidate.title,
    candidate.publishedAt,
    candidate.summary,
    candidate.bodyText,
  );
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
