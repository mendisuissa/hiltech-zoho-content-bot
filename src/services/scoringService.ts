import type { ContentCategory, ContentAudience, SourceProduct } from '@prisma/client';
import { normalizeWhitespace } from '../utils/hash';

export type ScoringInput = {
  title: string;
  summary: string;
  bodyText?: string | null;
  product: SourceProduct;
};

export type ScoringResult = {
  score: number;
  category: ContentCategory;
  audience: ContentAudience;
  signals: string[];
};

const businessTerms = [
  'lead',
  'sales',
  'pipeline',
  'customer',
  'service',
  'support',
  'automation',
  'process',
  'workflow',
  'report',
  'efficiency',
  'time',
  'control',
  'faster',
  'approval',
  'follow-up',
];

const consultantTerms = [
  'api',
  'integration',
  'field',
  'workflow',
  'blueprint',
  'custom',
  'portal',
  'permission',
  'template',
  'rule',
  'automation',
  'configuration',
  'report',
  'dashboard',
  'sla',
];

const productTerms: Record<SourceProduct, string[]> = {
  crm: ['crm', 'lead', 'deal', 'pipeline', 'contact', 'account', 'sales'],
  projects: ['project', 'task', 'milestone', 'timesheet', 'gantt', 'resource'],
  desk: ['desk', 'ticket', 'support', 'sla', 'department', 'customer service', 'service'],
};

function countHits(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

export function scoreZohoItem(input: ScoringInput): ScoringResult {
  const text = normalizeWhitespace(
    `${input.title} ${input.summary} ${input.bodyText ?? ''}`.toLowerCase(),
  );

  let score = 10;
  const signals: string[] = [];

  const productHitCount = countHits(text, productTerms[input.product]);
  score += productHitCount * 12;
  if (productHitCount > 0) {
    signals.push(`product:${productHitCount}`);
  }

  const businessHitCount = countHits(text, businessTerms);
  score += businessHitCount * 6;
  if (businessHitCount > 0) {
    signals.push(`business:${businessHitCount}`);
  }

  const consultantHitCount = countHits(text, consultantTerms);
  score += consultantHitCount * 5;
  if (consultantHitCount > 0) {
    signals.push(`consultant:${consultantHitCount}`);
  }

  if (/(what'?s new|release notes|new feature|enhancement|update)/i.test(text)) {
    score += 10;
    signals.push('release-update');
  }

  if (/(automation|workflow|approval|report|dashboard|integration)/i.test(text)) {
    score += 8;
    signals.push('operational-impact');
  }

  if (/(bug fix|minor fixes|performance improvements|security)/i.test(text)) {
    score -= 8;
    signals.push('maintenance-heavy');
  }

  score = Math.max(0, Math.min(100, score));

  let category: ContentCategory = 'skip';
  if (score >= 78) {
    category = 'article';
  } else if (score >= 62) {
    category = 'facebook_page';
  } else if (score >= 45) {
    category = 'facebook_group';
  } else if (score >= 30) {
    category = 'whatsapp';
  }

  const audience: ContentAudience =
    consultantHitCount > businessHitCount ? 'implementers_consultants' : 'business_owners';

  return { score, category, audience, signals };
}
