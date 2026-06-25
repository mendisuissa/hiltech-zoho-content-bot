import { HILTECH_SOCIAL_STYLE, HILTECH_STYLE_DNA } from './hiltechStyle';

type FacebookGroupPromptInput = {
  title: string;
  summary: string;
  sourceUrl: string;
  product: string;
  audience: string;
  score: number;
  editorialBrief?: { hebrewTitle?: string; hebrewSummary?: string; angle?: string; factsToPreserve?: string[]; claimsToAvoid?: string[] };
  rewriteInstructions?: string;
};

export function buildFacebookGroupPrompt(input: FacebookGroupPromptInput): string {
  return [
    'כתבו פוסט מקצועי בעברית לקבוצת Facebook שעוסקת ב-Zoho.',
    HILTECH_STYLE_DNA,
    HILTECH_SOCIAL_STYLE,
    'הקהל מגוון: בעלי עסקים, מנהלים, משתמשי מערכת, אנשי תפעול, אנשי מכירות, יועצים ואנשים טכניים יותר. הסבירו בפשטות, בלי להשטיח.',
    'התמקדו אך ורק במוצר שעליו מדבר המקור. אסור להזכיר מוצר Zoho אחר אם המקור אינו מתאר אותו.',
    'מבנה: הוק חזק ומסקרן שמושך לקריאה אך נשאר מקצועי ואמין; מה חדש בפועל; למה זה חשוב; דוגמה מתהליך עסקי אמיתי; מה כדאי לבדוק במערכת; טיפ פרקטי; סיום עם שאלה עדינה שמזמינה שיתוף ניסיון. אין קליקבייט, אין דרמה מוגזמת ואין הבטחות לא מבוססות.',
    'הפוסט הוא עדכון מקצועי ולא פרסומת. פיצ׳ר חדש אינו מספיק: הסבירו מה הוא מאפשר לעשות בפועל, רק על בסיס המקור.',
    'אורך יעד: 160–280 מילים. השתמשו בנקודות כאשר זה משפר קריאות. אין URL בגוף הפוסט ואין hashtags.',
    'החזירו JSON תקין בלבד: { "postText": string, "sourceUrl": string }',
    input.editorialBrief ? `Editorial brief: ${JSON.stringify(input.editorialBrief)}` : '',
    input.rewriteInstructions ? `Rewrite instructions: ${input.rewriteInstructions}` : '',
    `מוצר המקור: ${input.product}`,
    `קהל יעד: ${input.audience}`,
    `מקור: ${input.sourceUrl}`,
    `כותרת מקור: ${input.title}`,
    `תקציר מקור: ${input.summary}`,
  ].join('\n');
}
