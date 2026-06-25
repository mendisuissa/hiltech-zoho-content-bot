import { HILTECH_SOCIAL_STYLE, HILTECH_STYLE_DNA } from './hiltechStyle';

type WhatsAppPromptInput = {
  title: string;
  summary: string;
  sourceUrl: string;
  product: string;
  audience: string;
  score: number;
  editorialBrief?: { hebrewTitle?: string; hebrewSummary?: string; angle?: string; factsToPreserve?: string[]; claimsToAvoid?: string[] };
  rewriteInstructions?: string;
};

export function buildWhatsAppPrompt(input: WhatsAppPromptInput): string {
  return [
    'כתבו עדכון קצר בעברית לקבוצת WhatsApp מקצועית של Zoho.',
    HILTECH_STYLE_DNA,
    HILTECH_SOCIAL_STYLE,
    'זו קבוצה מקצועית, לא שיחה פרטית. אין פנייה אישית מדי, אין מכירה ישירה ואין פתיחות כמו "היי אהובה".',
    'העדכון חייב להתמקד רק במוצר שבמקור וביכולת החדשה עצמה.',
    'מבנה מומלץ: פתיחה קבוצתית קצרה עם הוק מסקרן ומקצועי; "מה חדש?" עם 1–3 שינויים קונקרטיים; שורה "למה זה רלוונטי?" או "מה כדאי לבדוק?". ההוק צריך לגרום לרצות לקרוא, לא להיות קליקבייט או מכירתי.',
    'אורך: 55–120 מילים. עד 3 נקודות קצרות. אין URL בתוך messageText ואין hashtags.',
    'הסבירו ערך מעשי בלי לכתוב הבטחות מכירה או תוצאות שאינן במקור. המטרה היא שאנשים ירצו לקרוא כי יש כאן ערך שוטף.',
    'החזירו JSON תקין בלבד: { "messageText": string, "sourceUrl": string }',
    input.editorialBrief ? `Editorial brief: ${JSON.stringify(input.editorialBrief)}` : '',
    input.rewriteInstructions ? `Rewrite instructions: ${input.rewriteInstructions}` : '',
    `מוצר המקור: ${input.product}`,
    `מקור: ${input.sourceUrl}`,
    `כותרת מקור: ${input.title}`,
    `תקציר מקור: ${input.summary}`,
  ].join('\n');
}
