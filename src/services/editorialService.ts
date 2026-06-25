import OpenAI from 'openai';
import type { ContentAudience, ContentCategory, SourceConfig, SourceItem } from '@prisma/client';
import { env, requireEnv } from '../config/env';
import { HILTECH_STYLE_DNA } from '../prompts/hiltechStyle';

export type UpdateType = 'new_feature' | 'enhancement' | 'integration' | 'availability' | 'ui_change' | 'deprecation' | 'fix' | 'mixed' | 'unknown';
export type EditorialBrief = {
  recommended: boolean;
  audience: 'business_owners' | 'implementers_consultants';
  category: 'article' | 'facebook_page' | 'facebook_group' | 'whatsapp' | 'skip';
  hebrewTitle: string;
  hebrewSummary: string;
  angle: string;
  updateType: UpdateType;
  changeLog: Array<{ change: string; evidence: string; importance: 'high' | 'medium' | 'low' }>;
  availabilityNotes: string[];
  limitations: string[];
  factsToPreserve: string[];
  claimsToAvoid: string[];
  rationale: string;
};

function getClient(): OpenAI {
  const { OPENAI_API_KEY } = requireEnv('OPENAI_API_KEY');
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}
function parseJson<T>(value: string): T {
  const clean = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(clean) as T;
}

export async function createEditorialBrief(source: SourceConfig, item: SourceItem): Promise<EditorialBrief> {
  const response = await getClient().chat.completions.create({
    model: env.OPENAI_MODEL,
    temperature: 0.05,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return only valid JSON. You are a meticulous Hebrew Zoho release-notes editor. Never invent facts or business outcomes.' },
      { role: 'user', content: [
        'Create an update-intelligence editorial brief for HilTech before writing.',
        HILTECH_STYLE_DNA,
        'The primary task is to extract every meaningful product change from the official source, not to promote Zoho.',
        'Return JSON exactly with: recommended, audience, category, hebrewTitle, hebrewSummary, angle, updateType, changeLog, availabilityNotes, limitations, factsToPreserve, claimsToAvoid, rationale.',
        'changeLog is an array of {change,evidence,importance}; each change must be directly grounded in source text. If the source has no verifiable feature details, set recommended=false.',
        'availabilityNotes and limitations must include only explicit source facts. Use empty arrays if absent; do not guess.',
        'claimsToAvoid must include unsupported sales, ROI, time-saving or cross-product claims where relevant.',
        `Product: ${source.product}`,
        `Official URL: ${item.canonicalUrl}`,
        `Source title: ${item.title}`,
        `Source summary: ${item.summary}`,
        `Source text: ${item.bodyText ?? item.summary}`,
      ].join('\n') },
    ],
  });
  return parseJson<EditorialBrief>(response.choices[0]?.message?.content ?? '{}');
}

export function normalizeEditorialBrief(brief: EditorialBrief, fallbackAudience: ContentAudience, fallbackCategory: ContentCategory): EditorialBrief {
  const allowedTypes: UpdateType[] = ['new_feature', 'enhancement', 'integration', 'availability', 'ui_change', 'deprecation', 'fix', 'mixed', 'unknown'];
  const changeLog = Array.isArray(brief.changeLog) ? brief.changeLog
    .filter((item): item is { change: string; evidence: string; importance: 'high' | 'medium' | 'low' } => Boolean(item?.change && item?.evidence))
    .slice(0, 8)
    .map((item) => ({ change: String(item.change).trim(), evidence: String(item.evidence).trim(), importance: ['high', 'medium', 'low'].includes(item.importance) ? item.importance : 'medium' })) : [];
  return {
    recommended: Boolean(brief.recommended) && changeLog.length > 0,
    audience: brief.audience === 'implementers_consultants' ? 'implementers_consultants' : fallbackAudience,
    category: ['article', 'facebook_page', 'facebook_group', 'whatsapp', 'skip'].includes(brief.category) ? brief.category : fallbackCategory,
    hebrewTitle: brief.hebrewTitle?.trim() || 'עדכון Zoho חדש שכדאי לבדוק',
    hebrewSummary: brief.hebrewSummary?.trim() || 'זוהה עדכון רשמי חדש של Zoho.',
    angle: brief.angle?.trim() || 'הסבר מעשי ומבוסס מקור על העדכון.',
    updateType: allowedTypes.includes(brief.updateType) ? brief.updateType : 'unknown',
    changeLog,
    availabilityNotes: Array.isArray(brief.availabilityNotes) ? brief.availabilityNotes.map(String).slice(0, 6) : [],
    limitations: Array.isArray(brief.limitations) ? brief.limitations.map(String).slice(0, 6) : [],
    factsToPreserve: Array.isArray(brief.factsToPreserve) ? brief.factsToPreserve.slice(0, 10) : changeLog.map((x) => x.change),
    claimsToAvoid: Array.isArray(brief.claimsToAvoid) ? brief.claimsToAvoid.slice(0, 10) : [],
    rationale: brief.rationale?.trim() || '',
  };
}
