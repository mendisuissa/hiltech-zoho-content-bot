import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectProjectsTimelineCandidatesFromHtml } from '../src/services/zohoProjectsParser';

const sourceUrl = 'https://www.zoho.com/projects/whats-new.html';
const fixture = readFileSync(join(process.cwd(), 'tests/fixtures/zoho-projects-whats-new-2026.html'), 'utf8');

describe('Zoho Projects What’s New parser', () => {
  const items = collectProjectsTimelineCandidatesFromHtml(fixture, sourceUrl);

  it('extracts current official 2026 updates from timeline year/month headings', () => {
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.title)).toEqual(expect.arrayContaining([
      'WhatsApp Integration (New)',
      'User Custom Fields and Revamped UI',
      'Field Level Permission for Time Logs (Enhancements)',
      'Custom Modules Support in Zoho Projects Mobile Apps (Mobile App)',
    ]));
  });

  it('assigns the correct official timeline dates', () => {
    const whatsapp = items.find((item) => item.title.startsWith('WhatsApp Integration'));
    const mobile = items.find((item) => item.title.startsWith('Custom Modules Support'));
    expect(whatsapp?.publishedAt?.toISOString()).toBe('2026-05-01T12:00:00.000Z');
    expect(mobile?.publishedAt?.toISOString()).toBe('2026-04-01T12:00:00.000Z');
  });

  it('keeps the official Help Center links and meaningful summaries', () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/help\.zoho\.com\/portal\//);
      expect(item.summary?.length).toBeGreaterThan(40);
    }
  });
});
