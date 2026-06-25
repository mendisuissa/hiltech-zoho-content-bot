import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

export type ZohoProjectsTimelineCandidate = {
  title: string;
  url: string;
  summary: string;
  bodyText: string;
  publishedAt: Date;
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8,
  oct: 9, nov: 10, dec: 11,
};

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function monthIndex(value: string): number | null {
  const key = normalize(value).toLowerCase().replace(/[^a-z]/g, '');
  return Object.prototype.hasOwnProperty.call(MONTHS, key) ? MONTHS[key] : null;
}

function headingYear(value: string): number | null {
  const match = normalize(value).match(/^(20\d{2})$/);
  return match ? Number(match[1]) : null;
}

function headingMonth(value: string): string | null {
  const cleaned = normalize(value).replace(/[^A-Za-z]/g, '');
  return monthIndex(cleaned) === null ? null : cleaned;
}

function dateFromTimeline(year: number | null, month: string | null): Date | null {
  if (!year || !month) return null;
  const index = monthIndex(month);
  return index === null ? null : new Date(Date.UTC(year, index, 1, 12, 0, 0));
}

function level(tagName: string | undefined): number {
  const match = (tagName ?? '').toLowerCase().match(/^h([1-6])$/);
  return match ? Number(match[1]) : 99;
}

function isOfficialHelpOrZoho(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'help.zoho.com' || host === 'www.zoho.com' || host === 'zoho.com' || host === 'blog.zoho.com';
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'update';
}

function readCardContent($: cheerio.CheerioAPI, heading: Element): { category?: string; summary: string; href?: string } {
  const headingLevel = level(heading.tagName);
  const body: string[] = [];
  let category: string | undefined;
  let href: string | undefined;
  let cursor = $(heading).next();
  let guard = 0;

  while (cursor.length && guard++ < 60) {
    const node = cursor.get(0) as Element | undefined;
    if (!node) break;
    const tag = (node.tagName ?? '').toLowerCase();
    const text = normalize(cursor.text());
    if (/^h[1-6]$/.test(tag) && level(tag) <= headingLevel) break;

    if (!category && /^(New|Enhancements?|Mobile App)$/i.test(text)) {
      category = text;
    } else if (tag === 'a' && /read more|learn more|more/i.test(text)) {
      href = cursor.attr('href') || undefined;
    } else if (text.length >= 40 && !body.includes(text)) {
      body.push(text);
    }

    if (!href) {
      const link = cursor.find('a[href]').filter((_, a) => /read more|learn more|more/i.test(normalize($(a).text()))).first();
      href = link.attr('href') || undefined;
    }
    cursor = cursor.next();
  }

  return { category, summary: normalize(body.join(' ')).slice(0, 900), href };
}

/**
 * Parses the Zoho Projects official What’s New timeline. The content date lives
 * in the preceding year/month headings, while the official article link can be
 * on help.zoho.com. This function intentionally parses only dated 2026+ items.
 */
export function collectProjectsTimelineCandidatesFromHtml(html: string, sourceUrl: string): ZohoProjectsTimelineCandidate[] {
  const $ = cheerio.load(html);
  const output: ZohoProjectsTimelineCandidate[] = [];
  const seen = new Set<string>();
  let year: number | null = null;
  let month: string | null = null;

  $('h1,h2,h3,h4,h5,h6').each((_, raw) => {
    const heading = raw as Element;
    const text = normalize($(heading).text());
    const tag = (heading.tagName ?? '').toLowerCase();
    if (!text) return;

    const possibleYear = headingYear(text);
    if (possibleYear) { year = possibleYear; month = null; return; }
    const possibleMonth = headingMonth(text);
    if (possibleMonth && year) { month = possibleMonth; return; }

    const publishedAt = dateFromTimeline(year, month);
    if (!publishedAt || publishedAt.getUTCFullYear() < 2026 || !/^h[4-6]$/.test(tag)) return;
    if (text.length < 4 || text.length > 180 || /^(timeline|all|blogs?|enhancements?|mobile app|new)$/i.test(text)) return;

    const card = readCardContent($, heading);
    if (/^Blogs?$/i.test(card.category ?? '') || card.summary.length < 40) return;

    const url = new URL(card.href ?? `#${slug(text)}`, sourceUrl);
    if (!isOfficialHelpOrZoho(url)) return;
    const canonical = url.toString();
    if (seen.has(canonical)) return;
    seen.add(canonical);

    const label = card.category ? ` (${card.category})` : '';
    output.push({
      title: `${text}${label}`,
      url: canonical,
      summary: card.summary,
      bodyText: normalize(`${text}. ${card.category ?? ''}. ${card.summary}`),
      publishedAt,
    });
  });

  return output.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
