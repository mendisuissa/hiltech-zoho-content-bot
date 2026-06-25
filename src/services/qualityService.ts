import OpenAI from 'openai';
import type { SourceConfig, SourceItem } from '@prisma/client';
import { env, requireEnv } from '../config/env';
import type { ArticleDraftPayload, FacebookGroupDraftPayload, FacebookPageDraftPayload, WhatsAppDraftPayload, CoverDraftPayload, ContentPack } from './contentGenerator';
import type { EditorialBrief } from './editorialService';

export type QualityDimension = { score: number; notes: string[] };
export type QualityReport = {
  overallScore: number;
  status: 'approved' | 'rewrite_required' | 'rejected';
  factCheck: QualityDimension;
  editorial: QualityDimension;
  style: QualityDimension;
  design: QualityDimension;
  social: QualityDimension;
  requiredFixes: string[];
  summary: string;
};

function client(): OpenAI {
  const { OPENAI_API_KEY } = requireEnv('OPENAI_API_KEY');
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}
function parseJson<T>(text: string): T { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()) as T; }

function basicDesignChecks(article: ArticleDraftPayload): string[] {
  const issues: string[] = [];
  const html = article.bodyHtml || '';
  if (!/<h2>/i.test(html)) issues.push('חסרות כותרות H2 במאמר.');
  if (/<h1/i.test(html)) issues.push('אסור להשתמש ב-H1 בתוך גוף המאמר.');
  if (!/<p>/i.test(html)) issues.push('גוף המאמר צריך להכיל פסקאות HTML.');
  if ((html.replace(/<[^>]+>/g, '').trim().length) < 750) issues.push('המאמר קצר מדי למאמר עומק.');
  if (!article.metaDescription || article.metaDescription.length < 120 || article.metaDescription.length > 165) issues.push('Meta description אינו בטווח 120–165 תווים.');
  if (!article.title || article.title.length > 72) issues.push('כותרת SEO חסרה או ארוכה מדי.');
  return issues;
}

export async function assessContentQuality(input: {
  source: SourceConfig;
  item: SourceItem;
  editorialBrief: EditorialBrief;
  content: ContentPack;
}): Promise<QualityReport> {
  const article = input.content.articleDraft.raw;
  const localDesignIssues = basicDesignChecks(article);
  const response = await client().chat.completions.create({
    model: env.OPENAI_MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return only valid JSON. You are HilTech\'s independent fact-checker, editorial QA and WordPress design QA. Be strict and do not give a perfect score by default.' },
      { role: 'user', content: [
        'Audit this content package as Zoho Updates Intelligence. Every factual feature claim must be traceable to the official source text. Also verify that every meaningful change in editorialBrief.changeLog is represented accurately in the article and that the package is not generic product promotion. Mark omissions, unsupported claims, generic sales language and cross-product mentions as failures.',
        'Evaluate: factCheck, editorial, style, design, social. Scores 0–100. Verify channel fit: WhatsApp must be short, professional and group-oriented (not a private sales message); Facebook Group must explain the concrete Zoho update with an example and a practical tip; Facebook Page must be a broader business-process insight where Zoho is an example rather than a hard sell. overallScore is the weighted result. approved requires: factCheck >= 90, editorial >= 85, style >= 85, design >= 80, social >= 85, overallScore >= 86, no critical unsupported claim, no missing high-importance change from changeLog, and no channel mismatch.',
        'Return exactly: overallScore, status (approved|rewrite_required|rejected), factCheck:{score,notes}, editorial:{score,notes}, style:{score,notes}, design:{score,notes}, social:{score,notes}, requiredFixes, summary.',
        `Official source URL: ${input.item.canonicalUrl}`,
        `Official source title: ${input.item.title}`,
        `Official source summary: ${input.item.summary}`,
        `Official source text: ${input.item.bodyText ?? input.item.summary}`,
        `Editorial brief: ${JSON.stringify(input.editorialBrief)}`,
        `Local design warnings: ${JSON.stringify(localDesignIssues)}`,
        `Article: ${JSON.stringify(article)}`,
        `Facebook Page: ${JSON.stringify(input.content.facebookPageDraft.raw)}`,
        `Facebook Group: ${JSON.stringify(input.content.facebookGroupDraft.raw)}`,
        `WhatsApp: ${JSON.stringify(input.content.whatsappDraft.raw)}`,
        `Cover: ${JSON.stringify(input.content.coverDraft.raw)}`,
      ].join('\n') },
    ],
  });
  const report = parseJson<QualityReport>(response.choices[0]?.message?.content ?? '{}');
  if (localDesignIssues.length) {
    report.design = { score: Math.min(report.design?.score ?? 100, 75), notes: [...(report.design?.notes ?? []), ...localDesignIssues] };
    report.requiredFixes = [...new Set([...(report.requiredFixes ?? []), ...localDesignIssues])];
    report.status = 'rewrite_required';
  }
  report.overallScore = Math.max(0, Math.min(100, Number(report.overallScore) || 0));
  return report;
}

export function qualityScore(report: QualityReport): number { return report.overallScore; }

export function buildRewriteInstructions(report: QualityReport): string {
  return [
    'This content package failed independent QA. Rewrite it without changing any unsupported facts.',
    'Required fixes:',
    ...(report.requiredFixes || []).map((x) => `- ${x}`),
    'Keep the package in Hebrew and preserve only claims supported by the official source.',
  ].join('\n');
}
