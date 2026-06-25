import OpenAI from 'openai';
import type { ContentAudience, ContentCategory, SourceConfig, SourceItem } from '@prisma/client';
import { env, requireEnv } from '../config/env';
import { logger } from '../utils/logger';
import { buildArticlePrompt } from '../prompts/article';
import { buildFacebookPagePrompt } from '../prompts/facebookPage';
import { buildFacebookGroupPrompt } from '../prompts/facebookGroup';
import { buildWhatsAppPrompt } from '../prompts/whatsapp';
import { buildCoverPrompt } from '../prompts/cover';
import type { EditorialBrief } from './editorialService';

function getClient(): OpenAI {
  const { OPENAI_API_KEY } = requireEnv('OPENAI_API_KEY');
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

export type GeneratedDraft<T = Record<string, unknown>> = {
  raw: T;
  sourceUrl: string;
};

export type ArticleDraftPayload = {
  title: string;
  slug: string;
  metaDescription: string;
  excerpt: string;
  bodyHtml: string;
  sourceUrl: string;
  editorNotes: string;
};

export type FacebookPageDraftPayload = {
  postText: string;
  cta: string;
  sourceUrl: string;
};

export type FacebookGroupDraftPayload = {
  postText: string;
  sourceUrl: string;
};

export type WhatsAppDraftPayload = {
  messageText: string;
  sourceUrl: string;
};

export type CoverDraftPayload = {
  prompt: string;
  altText: string;
};

export type ContentPack = {
  articleDraft: GeneratedDraft<ArticleDraftPayload>;
  facebookPageDraft: GeneratedDraft<FacebookPageDraftPayload>;
  facebookGroupDraft: GeneratedDraft<FacebookGroupDraftPayload>;
  whatsappDraft: GeneratedDraft<WhatsAppDraftPayload>;
  coverDraft: GeneratedDraft<CoverDraftPayload>;
};

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }
  return trimmed;
}

function safeJsonParse<T>(value: string): T {
  const cleaned = stripCodeFences(value);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('OpenAI response was not valid JSON');
  }
}

async function generateJson<T>(prompt: string): Promise<T> {
  const response = await getClient().chat.completions.create({
    model: env.OPENAI_MODEL,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return only valid JSON. No markdown. No code fences.' },
      { role: 'user', content: prompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? '';
  if (!text) {
    throw new Error('OpenAI returned an empty response');
  }
  return safeJsonParse<T>(text);
}

function baseContext(source: SourceConfig, item: SourceItem, brief?: EditorialBrief, rewriteInstructions?: string) {
  return {
    title: item.title,
    summary: item.summary,
    bodyText: item.bodyText ?? item.summary,
    sourceUrl: item.canonicalUrl,
    product: source.product,
    audience: item.audience,
    score: item.relevanceScore,
    editorialBrief: brief,
    rewriteInstructions,
  };
}

export async function generateContentPack(source: SourceConfig, item: SourceItem, brief?: EditorialBrief, rewriteInstructions?: string): Promise<ContentPack> {
  logger.info('Generating content pack', { source: source.name, title: item.title });
  const context = baseContext(source, item, brief, rewriteInstructions);

  const [articleDraft, facebookPageDraft, facebookGroupDraft, whatsappDraft, coverDraft] = await Promise.all([
    generateJson<ArticleDraftPayload>(buildArticlePrompt(context)),
    generateJson<FacebookPageDraftPayload>(buildFacebookPagePrompt(context)),
    generateJson<FacebookGroupDraftPayload>(buildFacebookGroupPrompt(context)),
    generateJson<WhatsAppDraftPayload>(buildWhatsAppPrompt(context)),
    generateJson<CoverDraftPayload>(buildCoverPrompt(context)),
  ]);

  return {
    articleDraft: { raw: articleDraft, sourceUrl: item.canonicalUrl },
    facebookPageDraft: { raw: facebookPageDraft, sourceUrl: item.canonicalUrl },
    facebookGroupDraft: { raw: facebookGroupDraft, sourceUrl: item.canonicalUrl },
    whatsappDraft: { raw: whatsappDraft, sourceUrl: item.canonicalUrl },
    coverDraft: { raw: coverDraft, sourceUrl: item.canonicalUrl },
  };
}

export function shouldGenerateContent(category: ContentCategory): boolean {
  return category !== 'skip';
}
