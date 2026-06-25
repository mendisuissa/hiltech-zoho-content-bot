import axios from 'axios';
import OpenAI from 'openai';
import type { ApprovalRequest, SourceItem } from '@prisma/client';
import { env, requireEnv } from '../config/env';
import { logger } from '../utils/logger';
import { applyHilTechBranding } from './brandCoverService';
import { prisma } from '../db/prisma';

const TELEGRAM_API = 'https://api.telegram.org';

type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: {
    message_id: number;
    chat: { id: number | string };
  };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function categoryLabel(value: string): string {
  return ({
    article: 'מאמר עומק',
    facebook_page: 'פוסט עסקי לעמוד',
    facebook_group: 'פוסט מקצועי לקבוצה',
    whatsapp: 'עדכון WhatsApp',
  } as Record<string, string>)[value] ?? value;
}

function audienceLabel(value: string): string {
  return ({
    business_owners: 'בעלי עסקים',
    implementers_consultants: 'מיישמים ויועצים',
  } as Record<string, string>)[value] ?? value;
}

function formatHebrewDate(value?: Date | null): string {
  if (!value) return 'תאריך הפרסום לא צוין במקור הרשמי';
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(value);
}

function sourceFooter(sourceUrl: string | undefined, publishedAt?: Date | null): string {
  const sourceLine = sourceUrl
    ? `<a href="${escapeHtml(sourceUrl)}">פתיחת המקור הרשמי של Zoho</a>`
    : 'מקור רשמי של Zoho לא זמין';
  return [
    '',
    '────────────',
    `<b>📅 תאריך החידוש:</b> ${escapeHtml(formatHebrewDate(publishedAt))}`,
    `<b>🔗 מקור:</b> ${sourceLine}`,
  ].join('\n');
}

function getTelegramConfig() {
  return requireEnv('TELEGRAM_BOT_TOKEN', 'TELEGRAM_APPROVER_CHAT_ID');
}

function telegramEndpoint(method: string): string {
  const { TELEGRAM_BOT_TOKEN } = getTelegramConfig();
  return `${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/${method}`;
}

function actionKeyboard(approvalId: string): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '👀 הצגת החבילה', callback_data: `preview:${approvalId}` },
        { text: '🔄 כתיבה מחדש', callback_data: `regenerate:${approvalId}` },
      ],
      [
        { text: '✅ אישור ושליחה', callback_data: `approve:${approvalId}` },
        { text: '❌ דחייה', callback_data: `reject:${approvalId}` },
      ],
      [
        { text: '🖼 יצירת קאבר', callback_data: `cover:${approvalId}` },
      ],
    ],
  };
}

async function sendTelegram(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await axios.post(telegramEndpoint(method), payload, { timeout: 30000 });
  if (!response.data?.ok) {
    throw new Error(`Telegram ${method} failed: ${String(response.data?.description ?? 'Unknown error')}`);
  }
  return response.data.result;
}

async function sendMessage(text: string, replyMarkup?: TelegramInlineKeyboard): Promise<number | undefined> {
  const { TELEGRAM_APPROVER_CHAT_ID } = getTelegramConfig();
  const result = await sendTelegram('sendMessage', {
    chat_id: TELEGRAM_APPROVER_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }) as { message_id?: number };
  return result.message_id;
}

async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await sendTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

async function editMessage(messageId: number, text: string, replyMarkup?: TelegramInlineKeyboard): Promise<void> {
  const { TELEGRAM_APPROVER_CHAT_ID } = getTelegramConfig();
  await sendTelegram('editMessageText', {
    chat_id: TELEGRAM_APPROVER_CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

function productLabelFromUrl(url: string): string {
  if (url.includes('/projects/')) return 'Zoho Projects';
  if (url.includes('/desk/')) return 'Zoho Desk';
  if (url.includes('/crm/')) return 'Zoho CRM';
  return 'Zoho';
}

function isMostlyEnglish(value: string): boolean {
  const letters = value.replace(/[^A-Za-zא-ת]/g, '');
  if (!letters) return false;
  const english = (letters.match(/[A-Za-z]/g) ?? []).length;
  const hebrew = (letters.match(/[א-ת]/g) ?? []).length;
  return english > hebrew;
}

function articleTitleFromApproval(approval: ApprovalRequest): string | undefined {
  const article = (approval.articleDraft ?? {}) as { title?: string; excerpt?: string; metaDescription?: string };
  const title = article.title?.trim();
  return title && !isMostlyEnglish(title) ? title : undefined;
}

function hebrewFallbackTitle(product: string): string {
  if (product === 'Zoho Projects') return 'עדכון חדש ב־Zoho Projects שכדאי לבדוק';
  if (product === 'Zoho Desk') return 'עדכון חדש ב־Zoho Desk שכדאי לבדוק';
  if (product === 'Zoho CRM') return 'עדכון חדש ב־Zoho CRM שכדאי לבדוק';
  return 'עדכון Zoho חדש שכדאי לבדוק';
}

function hebrewSummaryFromApproval(approval: ApprovalRequest, item: SourceItem): string {
  const article = (approval.articleDraft ?? {}) as { excerpt?: string; metaDescription?: string; title?: string };
  const preferred = article.excerpt || article.metaDescription;
  if (preferred && !isMostlyEnglish(preferred)) return truncate(preferred, 520);

  const sourceSummary = item.summary || item.title;
  if (sourceSummary && !isMostlyEnglish(sourceSummary)) return truncate(sourceSummary, 520);

  return 'זוהה עדכון רשמי חדש של Zoho. כדי לשמור על איכות התוכן, מומלץ לפתוח Preview ולבדוק את הזווית בעברית לפני אישור החבילה.';
}

function qualityLine(approval: ApprovalRequest): string {
  const report = (approval.qualityReport ?? {}) as { overallScore?: number; status?: string };
  const label = report.status === 'approved' ? '✅ עבר QA' : report.status === 'rewrite_required' ? '⚠️ עבר שכתוב ובדיקה' : '⛔ דורש בדיקה';
  return `<b>QA:</b> ${label} · ${report.overallScore ?? approval.qualityScore}/100`;
}

function approvalBrief(approval: ApprovalRequest, item: SourceItem): string {
  const product = productLabelFromUrl(item.canonicalUrl);
  const title = articleTitleFromApproval(approval) ?? hebrewFallbackTitle(product);
  const summary = hebrewSummaryFromApproval(approval, item);
  const sourceTitle = truncate(item.title, 180);

  return [
    '<b>🔔 חידוש Zoho חדש לבדיקה</b>',
    '',
    `<b>מוצר:</b> ${escapeHtml(product)}`,
    `<b>נושא מוצע:</b> ${escapeHtml(title)}`,
    '',
    '<b>תקציר בעברית</b>',
    escapeHtml(summary),
    '',
    `<b>קהל מומלץ:</b> ${escapeHtml(audienceLabel(approval.audience))}`,
    `<b>סוג תוכן מומלץ:</b> ${escapeHtml(categoryLabel(approval.category))}`,
    qualityLine(approval),
    '',
    '<b>מה עושים עכשיו?</b>',
    '👀 Preview – לראות את המאמר והפוסטים לפני אישור',
    '✅ אישור – לשלוח חבילת תוכן מלאה ומסודרת לקבוצה',
    '🔄 כתיבה מחדש – לבנות מחדש את החבילה לפי כללי התוכן העדכניים',
    '❌ דחייה – לסגור את העדכון הזה',
    '',
    `<i>כותרת המקור:</i> ${escapeHtml(sourceTitle)}`,
    `<b>📅 תאריך החידוש:</b> ${escapeHtml(formatHebrewDate(item.publishedAt))}`,
    `<a href="${escapeHtml(item.canonicalUrl)}">פתיחת המקור הרשמי של Zoho</a>`,
  ].join('\n');
}

function previewMessage(approval: ApprovalRequest): string {
  const article = (approval.articleDraft ?? {}) as { title?: string; excerpt?: string; metaDescription?: string; bodyHtml?: string; editorNotes?: string };
  const facebookPage = (approval.facebookPageDraft ?? {}) as { postText?: string };
  const facebookGroup = (approval.facebookGroupDraft ?? {}) as { postText?: string };
  const whatsapp = (approval.whatsappDraft ?? {}) as { messageText?: string };
  const qa = (approval.qualityReport ?? {}) as { overallScore?: number; status?: string; summary?: string; requiredFixes?: string[] };

  const qaScore = qa.overallScore ?? approval.qualityScore ?? 0;
  const qaStatus = qa.status === 'approved' ? '✅ מאושר' : qa.status === 'rewrite_required' ? '⚠️ דורש שכתוב' : '🟡 בבדיקה';
  const qaNote = qa.requiredFixes?.length
    ? qa.requiredFixes.slice(0, 2).map((item) => `• ${escapeHtml(item)}`).join('\n')
    : qa.summary && !isMostlyEnglish(qa.summary)
      ? escapeHtml(truncate(qa.summary, 260))
      : 'החבילה מוכנה לבדיקה אנושית לפני אישור.';

  return [
    '<b>👀 חבילת תוכן מוכנה לבדיקה</b>',
    '',
    `<b>📝 מאמר:</b> ${escapeHtml(article.title ?? approval.title)}`,
    `<b>🎯 QA:</b> ${qaStatus} · ${qaScore}/100`,
    '',
    '<b>מה יש בחבילה?</b>',
    `• מאמר לאתר – ${escapeHtml(truncate(article.excerpt || article.metaDescription || htmlToText(article.bodyHtml ?? ''), 180))}`,
    `• Facebook Page – ${escapeHtml(truncate(facebookPage.postText ?? '', 140))}`,
    `• קבוצת Zoho – ${escapeHtml(truncate(facebookGroup.postText ?? '', 140))}`,
    `• WhatsApp – ${escapeHtml(truncate(whatsapp.messageText ?? '', 140))}`,
    '',
    '<b>דגשי QA</b>',
    qaNote,
  ].filter(Boolean).join('\n');
}

function previewControlsMessage(): string {
  return [
    '<b>מה תרצו לעשות עם החבילה?</b>',
    '',
    '👀 הצגת החבילה – פתיחת תוכן מפורט לקריאה',
    '🔄 כתיבה מחדש – בנייה מחדש לפי כללי הכתיבה העדכניים',
    '✅ אישור ושליחה – שליחת 4 התכנים המלאים להעתקה',
    '❌ דחייה – סגירת העדכון',
  ].join('\n');
}

function detailedPreviewMessage(approval: ApprovalRequest): string {
  const article = (approval.articleDraft ?? {}) as { title?: string; excerpt?: string; metaDescription?: string; bodyHtml?: string; editorNotes?: string };
  const facebookPage = (approval.facebookPageDraft ?? {}) as { postText?: string };
  const facebookGroup = (approval.facebookGroupDraft ?? {}) as { postText?: string };
  const whatsapp = (approval.whatsappDraft ?? {}) as { messageText?: string };

  return [
    '<b>📋 פרטי חבילת התוכן</b>',
    '',
    '<b>📝 מאמר לאתר</b>',
    `<b>${escapeHtml(article.title ?? approval.title)}</b>`,
    escapeHtml(truncate(article.excerpt || article.metaDescription || htmlToText(article.bodyHtml ?? ''), 950)),
    '',
    '<b>📣 Facebook Page</b>',
    escapeHtml(truncate(facebookPage.postText ?? '', 700)),
    '',
    '<b>👥 קבוצת Facebook Zoho</b>',
    escapeHtml(truncate(facebookGroup.postText ?? '', 760)),
    '',
    '<b>💬 WhatsApp</b>',
    escapeHtml(truncate(whatsapp.messageText ?? '', 500)),
    article.editorNotes && article.editorNotes !== 'אין' ? `\n<b>בדיקה לפני פרסום:</b> ${escapeHtml(article.editorNotes)}` : '',
  ].filter(Boolean).join('\n');
}

export async function sendApprovalNotification(approval: ApprovalRequest, item: SourceItem): Promise<void> {
  const messageId = await sendMessage(approvalBrief(approval, item), actionKeyboard(approval.id));
  if (messageId) {
    await import('../db/prisma').then(({ prisma }) => prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { telegramMessageId: String(messageId) },
    }));
  }
  logger.info('Telegram approval notification sent', { approvalId: approval.id, messageId });
}

export async function sendApprovalPreview(approval: ApprovalRequest): Promise<void> {
  // Keep the long review content separate from its controls: Telegram preserves the
  // action bar as the final, uncluttered message even after a rewrite has produced a lot of text.
  await sendMessage(previewMessage(approval));
  await sendMessage(previewControlsMessage(), actionKeyboard(approval.id));
  logger.info('Telegram preview and review controls sent', { approvalId: approval.id });
}

export async function sendDetailedApprovalPreview(approval: ApprovalRequest): Promise<void> {
  await sendMessage(detailedPreviewMessage(approval));
  await sendMessage(previewControlsMessage(), actionKeyboard(approval.id));
  logger.info('Telegram detailed preview and review controls sent', { approvalId: approval.id });
}

export async function markTelegramApprovalMessage(
  approval: ApprovalRequest,
  status: 'approved' | 'rejected',
  callbackQuery?: TelegramCallbackQuery,
): Promise<void> {
  const messageId = callbackQuery?.message?.message_id ?? Number(approval.telegramMessageId);
  if (!Number.isFinite(messageId)) return;
  const text = status === 'approved'
    ? '<b>✅ אושר</b>\nחבילת התוכן המלאה נשלחה לקבוצה. הפרסום באתר נשאר ידני.'
    : '<b>❌ נדחה</b>\nהעדכון סומן כלא רלוונטי ולא יופיע שוב בתור האישורים.';
  await editMessage(messageId, text);
}

export async function acknowledgeTelegramCallback(callbackQueryId: string, text?: string): Promise<void> {
  await answerCallbackQuery(callbackQueryId, text);
}

export function isConfiguredApprovalChat(chatId: number | string | undefined): boolean {
  return chatId !== undefined && String(chatId) === String(env.TELEGRAM_APPROVER_CHAT_ID ?? '');
}

export async function sendApprovedContentPack(approval: ApprovalRequest): Promise<void> {
  const article = (approval.articleDraft ?? {}) as { title?: string; metaDescription?: string; excerpt?: string; bodyHtml?: string; sourceUrl?: string; editorNotes?: string };
  const facebookPage = (approval.facebookPageDraft ?? {}) as { postText?: string; cta?: string; sourceUrl?: string };
  const facebookGroup = (approval.facebookGroupDraft ?? {}) as { postText?: string; sourceUrl?: string };
  const whatsapp = (approval.whatsappDraft ?? {}) as { messageText?: string; sourceUrl?: string };
  const sourceItem = await prisma.sourceItem.findUnique({
    where: { id: approval.sourceItemId },
    select: { canonicalUrl: true, publishedAt: true },
  });
  const officialUrl = sourceItem?.canonicalUrl ?? article.sourceUrl ?? facebookPage.sourceUrl ?? facebookGroup.sourceUrl ?? whatsapp.sourceUrl;
  const footer = sourceFooter(officialUrl, sourceItem?.publishedAt);

  const articleText = [
    '<b>📝 מאמר לאתר – מוכן להעתקה</b>',
    '',
    `<b>SEO Title:</b> ${escapeHtml(article.title ?? approval.title)}`,
    article.metaDescription ? `<b>Meta description:</b> ${escapeHtml(article.metaDescription)}` : '',
    article.excerpt ? `<b>תקציר:</b> ${escapeHtml(article.excerpt)}` : '',
    '',
    escapeHtml(htmlToText(article.bodyHtml ?? '')),
    article.editorNotes && article.editorNotes !== 'אין' ? `\n<b>בדיקה לפני פרסום:</b> ${escapeHtml(article.editorNotes)}` : '',
    footer,
  ].filter(Boolean).join('\n');

  const pageText = [
    '<b>📣 Facebook Page – מוכן להעתקה</b>', '',
    escapeHtml(facebookPage.postText ?? ''),
    facebookPage.cta ? `\n${escapeHtml(facebookPage.cta)}` : '',
    footer,
  ].filter(Boolean).join('\n');

  const groupText = [
    '<b>👥 Facebook Group – מוכן להעתקה</b>', '',
    escapeHtml(facebookGroup.postText ?? ''),
    footer,
  ].filter(Boolean).join('\n');

  const whatsappText = [
    '<b>💬 WhatsApp – מוכן להעתקה</b>', '',
    escapeHtml(whatsapp.messageText ?? ''),
    footer,
  ].filter(Boolean).join('\n');

  const messages = [articleText, pageText, groupText, whatsappText];
  for (const message of messages) {
    let remaining = message;
    while (remaining.length > 4096) {
      const cut = remaining.lastIndexOf('\n', 4000);
      await sendMessage(remaining.slice(0, cut > 0 ? cut : 4000));
      remaining = remaining.slice(cut > 0 ? cut : 4000);
    }
    await sendMessage(remaining);
  }
  logger.info('Telegram approved content pack sent', { approvalId: approval.id, messages: messages.length });
}


export async function generateAndSendCoverImage(approval: ApprovalRequest): Promise<void> {
  const cover = (approval.coverDraft ?? {}) as { prompt?: string; altText?: string };
  if (!cover.prompt) throw new Error('Cover prompt is unavailable for this approval');
  const { OPENAI_API_KEY } = requireEnv('OPENAI_API_KEY');
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const result = await client.images.generate({
    model: env.OPENAI_IMAGE_MODEL,
    prompt: cover.prompt,
    size: '1536x1024',
    quality: 'medium',
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI did not return a cover image');
  const form = new FormData();
  const imageBuffer = Buffer.from(b64, 'base64');
  form.append('chat_id', String(env.TELEGRAM_APPROVER_CHAT_ID));
  form.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'hiltech-zoho-cover.png');
  form.append('caption', `🖼 תמונת קאבר מוצעת\n${cover.altText ?? approval.title}`);
  const response = await fetch(telegramEndpoint('sendPhoto'), { method: 'POST', body: form });
  const payload = await response.json() as { ok?: boolean; description?: string };
  if (!response.ok || !payload.ok) throw new Error(`Telegram sendPhoto failed: ${payload.description ?? response.statusText}`);
  logger.info('Telegram cover image sent', { approvalId: approval.id });
}
