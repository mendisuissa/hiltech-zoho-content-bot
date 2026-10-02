import { trustedTelegramIdentity, holdHiltech, heldResponse } from '../services/actionSecurity';
import { Router, type Request, type Response } from 'express';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import {
  acknowledgeTelegramCallback,
  isConfiguredApprovalChat,
  markTelegramApprovalMessage,
  sendApprovedContentPack,
  sendApprovalPreview,
  sendDetailedApprovalPreview,
  generateAndSendCoverImage,
  sendTelegramTextMessage,
  sendTelegramMenuMessage,
  type TelegramCallbackQuery,
} from '../services/telegramService';
import { runZohoScan } from '../services/zohoScanner';
import { logger } from '../utils/logger';
import { regeneratePendingApproval } from '../services/regenerationService';
import { generateContentPack } from '../services/contentGenerator';
import { executeHiltechKernelTask } from '../services/kernelClient';

type TelegramMessage = {
  message_id: number;
  chat: { id: number | string };
  text?: string;
};

type TelegramUpdate = {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
};

export const telegramRouter = Router();

function verifyTelegramWebhook(req: Request): boolean { return trustedTelegramIdentity(req)!==null; }

async function getPendingApproval(id: string) {
  return prisma.approvalRequest.findFirst({ where: { id, status: 'pending' } });
}

async function processTelegramMessage(update: TelegramUpdate): Promise<void> {
  holdHiltech();
  const message = update.message;
  const text = message?.text?.trim();

  if (!message || !text) return;

  if (!isConfiguredApprovalChat(message.chat.id)) {
    logger.warn('Telegram message ignored from unauthorized chat', {
      chatId: message.chat.id,
    });
    return;
  }

  if (text.startsWith('/start') || text.startsWith('/menu') || text.startsWith('/hmenu')) {
    await sendTelegramMenuMessage();
    return;
  }

  // Skip unknown slash commands — don't route to kernel
  if (text.startsWith('/')) {
    await sendTelegramTextMessage('❓ פקודה לא מוכרת. שלחי /menu לתפריט הראשי.');
    return;
  }

  try {
    await sendTelegramTextMessage('🧠 קיבלתי, מכינה תשובה…');

    const result = await executeHiltechKernelTask(text);

    if (!result.ok) {
      await sendTelegramTextMessage(
        [
          '⚠️ עצרתי לפני ביצוע.',
          result.status ? `סטטוס: ${result.status}` : '',
          result.message ? `סיבה: ${result.message}` : '',
          result.capabilityId ? `יכולת: ${result.capabilityId}` : '',
        ].filter(Boolean).join('\n')
      );
      return;
    }

    await sendTelegramTextMessage(result.output || 'בוצע, אבל לא חזר פלט.');
  } catch (error) {
    logger.error('Telegram smart message processing failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    await sendTelegramTextMessage('❌ הייתה שגיאה בעיבוד הבקשה. נסי שוב עוד רגע.');
  }
}

async function processTelegramCallback(update: TelegramUpdate): Promise<void> {
  holdHiltech();
  const callback = update.callback_query;
  if (!callback?.data || !callback.message) return;

  if (!isConfiguredApprovalChat(callback.message.chat.id)) {
    try {
      await acknowledgeTelegramCallback(callback.id, 'הפעולה מותרת רק בקבוצת ניהול HilTech.');
    } catch (error) {
      logger.warn('Telegram callback acknowledgement failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const [action, approvalId] = callback.data.split(':', 2);

  // Menu shortcut buttons
  if (action === 'menu') {
    await acknowledgeTelegramCallback(callback.id, 'מכינה תוכן…').catch(() => undefined);
    if (approvalId === 'ingest') {
      await acknowledgeTelegramCallback(callback.id, 'קולטת חידושים…').catch(() => undefined);
      try {
        await sendTelegramTextMessage('📰 מתחילה קליטת חידושים מ-Zoho…');
        const result = await runZohoScan();
        const count = result?.itemsStored ?? 0;
        await sendTelegramTextMessage(`✅ קליטה הסתיימה — ${count} חידושים נשמרו`);
      } catch (err) {
        await sendTelegramTextMessage('❌ קליטה נכשלה. בדקי לוגים.');
      }
      return;
    }

    if (['facebook', 'whatsapp', 'article'].includes(approvalId ?? '')) {
      try {
        await sendTelegramTextMessage('🧠 מכינה תוכן על בסיס החידוש האחרון שנקלט…');

        // Fetch latest ingested item from DB
        const item = await prisma.sourceItem.findFirst({
          orderBy: { publishedAt: 'desc' },
          where: { publishedAt: { not: null } },
          include: { sourceConfig: true },
        });

        if (!item || !item.sourceConfig) {
          await sendTelegramTextMessage('📭 אין חידושים בבסיס הנתונים. הרצי קליטה קודם.');
          return;
        }

        const pack = await generateContentPack(item.sourceConfig, item);

        if (approvalId === 'facebook') {
          const post = pack.facebookPageDraft.raw;
          const text = [
            `📣 <b>פוסט לעמוד Facebook</b>`,
            `<i>מבוסס על: ${item.title?.slice(0, 80)}</i>`,
            '',
            post.postText ?? '',
            post.cta ? `\n${post.cta}` : '',
          ].filter(Boolean).join('\n');
          await sendTelegramTextMessage(text);
        } else if (approvalId === 'whatsapp') {
          const msg = pack.whatsappDraft.raw;
          const text = [
            `💬 <b>הודעת WhatsApp</b>`,
            `<i>מבוסס על: ${item.title?.slice(0, 80)}</i>`,
            '',
            msg.messageText ?? '',
          ].filter(Boolean).join('\n');
          await sendTelegramTextMessage(text);
        } else if (approvalId === 'article') {
          const article = pack.articleDraft.raw;
          const text = [
            `📝 <b>${article.title ?? item.title}</b>`,
            article.excerpt ? `\n<i>${article.excerpt}</i>` : '',
            '',
            article.bodyHtml
              ?.replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/p>/gi, '\n\n')
              .replace(/<[^>]+>/g, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
              .slice(0, 3500) ?? '',
          ].filter(Boolean).join('\n');
          await sendTelegramTextMessage(text);
        }
      } catch (err) {
        await sendTelegramTextMessage('❌ שגיאה בהכנת תוכן. נסי שוב.');
      }
      return;
    }

    // tip — still kernel-free, direct OpenAI call
    if (approvalId === 'tip') {
      try {
        await sendTelegramTextMessage('💡 מכינה טיפ…');
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const res = await client.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          temperature: 0.85,
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `אתה הילה סויסה — מומחית Zoho CRM ישראלית. תני טיפ מקצועי אחד.

חוקים:
- פתחי עם בעיה שמנהל/ת מכירות מכיר/ה ("כמה פעמים קרה לך ש...")
- ציין פיצ'ר ספציפי בשמו המדויק (Blueprint, Cadence, SalesSignals, Workflow...)
- הסבירי מה עושים בשלב אחד או שניים — לא תיאוריה
- אין "מרגש", אין "שמחים", אין "חידוש מהפכני"
- 4-6 שורות. עברית ישירה.`,
          }],
        });
        const tip = res.choices[0]?.message?.content?.trim() ?? 'לא הצלחתי ליצור טיפ.';
        await sendTelegramTextMessage(`💡 <b>טיפ Zoho</b>\n\n${tip}`);
      } catch (err) {
        await sendTelegramTextMessage('❌ שגיאה. נסי שוב.');
      }
      return;
    }

    await sendTelegramTextMessage('פעולה לא מוכרת.');
    return;
  }

  if (!approvalId || !['preview', 'approve', 'reject', 'cover', 'regenerate'].includes(action)) {
    try {
      await acknowledgeTelegramCallback(callback.id, 'פעולה לא תקינה.');
    } catch (error) {
      logger.warn('Telegram callback acknowledgement failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  try {
    await acknowledgeTelegramCallback(
      callback.id,
      action === 'regenerate' ? 'הכתיבה מחדש התחילה…' : 'הפעולה התקבלה…'
    );
  } catch (error) {
    logger.warn('Telegram callback acknowledgement failed', {
      approvalId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const approval = await getPendingApproval(approvalId);
  if (!approval) {
    await sendApprovalPreviewMessageUnavailable(callback.message.chat.id, 'הפריט כבר טופל או אינו זמין.');
    return;
  }

  if (action === 'preview') {
    await sendDetailedApprovalPreview(approval);
    return;
  }

  if (action === 'cover') {
    await generateAndSendCoverImage(approval);
    return;
  }

  if (action === 'regenerate') {
    const regenerated = await regeneratePendingApproval(approval.id);
    if (!regenerated) {
      await sendApprovalPreviewMessageUnavailable(callback.message.chat.id, 'הפריט כבר אינו זמין לכתיבה מחדש.');
      return;
    }
    await sendApprovalPreview(regenerated);
    logger.info('Telegram approval regenerated', { approvalId: approval.id });
    return;
  }

  if (action === 'approve') {
    const updated = await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { status: 'approved', approvedAt: new Date() },
    });

    await sendApprovedContentPack(updated);
    await markTelegramApprovalMessage(updated, 'approved', callback);
    logger.info('Telegram approval completed', { approvalId: approval.id });
    return;
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: approval.id },
    data: {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectionReason: 'Rejected from Telegram',
    },
  });

  await markTelegramApprovalMessage(updated, 'rejected', callback);
  logger.info('Telegram rejection completed', { approvalId: approval.id });
}

async function sendApprovalPreviewMessageUnavailable(_chatId: number | string, text: string): Promise<void> {
  logger.info('Telegram callback unavailable', { text });
}

telegramRouter.post('/webhook', (req: Request, res: Response) => {
  if (!verifyTelegramWebhook(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return heldResponse(res);

  res.sendStatus(200);

  const update = req.body as TelegramUpdate;

  if (update.message) {
    void processTelegramMessage(update).catch((error) => {
      logger.error('Telegram webhook message processing failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
    return;
  }

  void processTelegramCallback(update).catch((error) => {
    logger.error('Telegram webhook callback processing failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
});