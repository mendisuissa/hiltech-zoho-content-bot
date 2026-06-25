import { HILTECH_SOCIAL_STYLE, HILTECH_STYLE_DNA } from './hiltechStyle';

type FacebookPagePromptInput = {
  title: string;
  summary: string;
  sourceUrl: string;
  product: string;
  audience: string;
  score: number;
  editorialBrief?: { hebrewTitle?: string; hebrewSummary?: string; angle?: string; factsToPreserve?: string[]; claimsToAvoid?: string[] };
  rewriteInstructions?: string;
};

export function buildFacebookPagePrompt(input: FacebookPagePromptInput): string {
  return [
    'כתבו פוסט בעברית לדף Facebook של הילה / HilTech.',
    HILTECH_STYLE_DNA,
    HILTECH_SOCIAL_STYLE,
    'זהו דף ערך עסקי רחב: דברו על סדר בעסק, CRM, תהליכי עבודה, ניהול לקוחות, אוטומציה, מעקב או מידע מפוזר. Zoho יכול להיות דוגמה, אך אינו חייב להיות מרכז כל משפט.',
    'פתחו בתובנה שמזהה בעיה מוכרת בלי להטיף, למשל עבודה מהראש, משימות שחוזרות על עצמן או מידע שמתפזר בין כלים — רק אם יש חיבור אמיתי לעדכון המקור.',
    'חברו את החידוש של Zoho לדוגמה פרקטית, בלי להציג אותו כפתרון קסם ובלי להבטיח מכירות, חיסכון, ROI או מניעת פספוסים.',
    'סיימו בתובנה, שאלה או CTA עדין ולא מכירתי. המטרה היא מיתוג כמומחית לסדר, תהליכים ומערכות — לא כמוכרת תוכנה.',
    'אורך יעד: 110–190 מילים, 2–5 פסקאות קצרות, 0–2 אימוג׳ים בלבד. אין hashtags ואין URL בתוך postText.',
    'החזירו JSON תקין בלבד: { "postText": string, "cta": string, "sourceUrl": string }',
    input.editorialBrief ? `Editorial brief: ${JSON.stringify(input.editorialBrief)}` : '',
    input.rewriteInstructions ? `Rewrite instructions: ${input.rewriteInstructions}` : '',
    `מוצר המקור: ${input.product}`,
    `מקור: ${input.sourceUrl}`,
    `כותרת מקור: ${input.title}`,
    `תקציר מקור: ${input.summary}`,
  ].join('\n');
}
