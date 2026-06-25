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

  // This selector matches the actual Zoho Projects What’s New DOM:
  // .event-category-year-wrap#2026 > .event-category-wrap#2026-may > .event-category
  // The title, summary and Read More link all live inside each event-category card.
  $('.event-category-year-wrap').each((_, yearWrap) => {
    const yearText = normalize($(yearWrap).children('h2').first().text()) || String($(yearWrap).attr('id') ?? '');
    const yearMatch = yearText.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    if (!year || year < 2026) return;

    $(yearWrap).children('.event-category-wrap').each((_, monthWrap) => {
      const monthText = normalize($(monthWrap).children('h3').first().text()) || String($(monthWrap).attr('id') ?? '').replace(/^\d{4}-/, '');
      const publishedAt = dateFromTimeline(year, monthText);
      if (!publishedAt) return;

      $(monthWrap).children('.event-category').each((_, card) => {
        const titleText = normalize($(card).find('.head h4').first().text());
        if (!titleText) return;

        const category = normalize($(card).find('.head .tag').first().text());
        const summary = normalize($(card).find('.whatsnew-desc p').map((__, p) => $(p).text()).get().join(' ')).slice(0, 900);
        const href = $(card).find('.whatsnew-desc a.read-more[href], .whatsnew-desc a[href]').first().attr('href');
        if (summary.length < 40 || !href) return;

        let url: URL;
        try {
          url = new URL(href, sourceUrl);
        } catch {
          return;
        }
        if (!isOfficialHelpOrZoho(url)) return;
        const canonical = url.toString();
        if (seen.has(canonical)) return;
        seen.add(canonical);

        const label = category ? ` (${category})` : '';
        output.push({
          title: `${titleText}${label}`,
          url: canonical,
          summary,
          bodyText: normalize(`${titleText}. ${category}. ${summary}`),
          publishedAt,
        });
      });
    });
  });

  return output.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
