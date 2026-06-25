import { describe, expect, it } from 'vitest';
import { scoreZohoItem } from '../src/services/scoringService';

describe('scoreZohoItem', () => {
  it('scores CRM updates as relevant', () => {
    const result = scoreZohoItem({
      title: 'Zoho CRM gets a new workflow automation feature',
      summary: 'A release note about sales automation and lead control.',
      bodyText: 'This update helps teams reduce lost leads and improve follow-up speed.',
      product: 'crm',
    });

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(['article', 'facebook_page', 'facebook_group', 'whatsapp']).toContain(result.category);
    expect(result.audience).toBeDefined();
  });

  it('skips low relevance maintenance notes', () => {
    const result = scoreZohoItem({
      title: 'Minor bug fixes',
      summary: 'Performance improvements and security fixes.',
      bodyText: 'No functional business changes were introduced.',
      product: 'desk',
    });

    expect(result.category).toBe('skip');
  });
});
