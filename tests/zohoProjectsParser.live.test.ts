import axios from 'axios';
import { describe, expect, it } from 'vitest';
import { collectProjectsTimelineCandidatesFromHtml } from '../src/services/zohoProjectsParser';

const runLive = process.env.RUN_LIVE_ZOHO_TEST === '1';
const maybeDescribe = runLive ? describe : describe.skip;

maybeDescribe('Zoho Projects live parser smoke test', () => {
  it('finds dated official 2026+ updates on the current What’s New page', async () => {
    const sourceUrl = 'https://www.zoho.com/projects/whats-new.html';
    const response = await axios.get<string>(sourceUrl, {
      timeout: 30_000,
      headers: { 'User-Agent': 'HilTech Zoho Content Bot parser test/1.0' },
    });
    const items = collectProjectsTimelineCandidatesFromHtml(response.data, sourceUrl);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => (item.publishedAt?.getUTCFullYear() ?? 0) >= 2026)).toBe(true);
  }, 40_000);
});
