import { HILTECH_STYLE_DNA, hiltechArticleStructure } from './hiltechStyle';

type ArticlePromptInput = {
  title: string;
  summary: string;
  bodyText: string;
  sourceUrl: string;
  product: string;
  audience: string;
  score: number;
  editorialBrief?: { hebrewTitle?: string; hebrewSummary?: string; angle?: string; factsToPreserve?: string[]; claimsToAvoid?: string[] };
  rewriteInstructions?: string;
};

export function buildArticlePrompt(input: ArticlePromptInput): string {
  const audienceInstruction = input.audience === 'implementers_consultants'
    ? 'כתבו לקהל מתקדם של מטמיעים ויועצים. העמיקו בנקודות יישום ובבדיקות, אך אל תמציאו צעדים טכניים שלא קיימים במקור.'
    : 'כתבו לבעלי עסקים. הסבירו כל מושג בצורה פשוטה, עם דוגמאות עבודה יומיומיות; אל תניחו ידע מוקדם ב-Zoho.';

  return [
    'את/ה עורך/ת התוכן של HilTech, מומחית Zoho ישראלית. כתבו בעברית טבעית בלבד.',
    'כתבו מאמר עדכונים מקצועי בעברית על שינוי Zoho יחיד. המטרה היא להסביר מה חדש ומה נוסף, לא לשווק את המוצר ולא לתרגם release notes מילה במילה. הפתיחה חייבת להיות הוק חזק, מסקרן ומקצועי שמושך לקרוא, אך בלי קליקבייט, דרמה או הבטחות שלא נתמכות במקור.',
    HILTECH_STYLE_DNA,
    audienceInstruction,
    hiltechArticleStructure(input.audience),
    '',
    'כללי אמינות מחייבים:',
    '- הסתמכו רק על נתוני המקור המצורפים. אל תמציאו יכולות, תמחור, רישיונות, זמינות, תוצאות או אינטגרציות.',
    '- אם המקור אינו מספק מספיק מידע כדי לתאר שלב הגדרה מדויק, אל תכתבו מדריך מדומה; כתבו במקום זאת מה צריך לאמת לפני ההפעלה.',
    '- כל שינוי מתוך editorialBrief.changeLog חייב לקבל ביטוי במאמר. אל תדלגו על יכולת חדשה שמופיעה במקור.',
    '- תנו עדיפות לשאלה מה השתנה בפועל, מה זה מאפשר לעשות, ומה צריך לבדוק. תועלת עסקית כללית אינה תחליף להסבר יכולת.',
    '- תרגמו את כותרת המקור לעברית טבעית. אפשר להשאיר שמות מוצר ופיצ׳רים רשמיים באנגלית בסוגריים.',
    '- אל תכתבו "בעידן הדיגיטלי", "חשוב לציין", "שותף אסטרטגי", "מהפכה", "תוצאות מדידות" או משפטי AI כלליים.',
    '- אל תוסיפו חתימה אישית אלא אם ביקשו זאת במפורש. אין להשתמש בשם כותב/ת בדוי.',
    '- כשאין מידע על זמינות, רישוי, rollout או מגבלה, כתבו במפורש שהדבר לא צוין במקור במקום לנחש.',
    '',
    'כללי HTML:',
    '- bodyHtml חייב להיות HTML נקי בלבד: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong> לפי הצורך.',
    '- פסקאות קצרות; אין markdown בתוך bodyHtml; אין <h1>.',
    '',
    'החזירו JSON תקין בלבד עם השדות:',
    '{ "title": string, "slug": string, "metaDescription": string, "excerpt": string, "bodyHtml": string, "sourceUrl": string, "editorNotes": string }',
    'title עד 72 תווים; metaDescription באורך 120–160 תווים; excerpt באורך 80–150 תווים.',
    'editorNotes בעברית קצרה: ציינו מה דורש אימות ידני לפני פרסום, או "אין".',
    input.editorialBrief ? `Editorial brief: ${JSON.stringify(input.editorialBrief)}` : '',
    input.rewriteInstructions ? `Rewrite instructions: ${input.rewriteInstructions}` : '',
    `מוצר: ${input.product}`,
    `קהל: ${input.audience}`,
    `מקור רשמי: ${input.sourceUrl}`,
    `כותרת מקור: ${input.title}`,
    `תקציר מקור: ${input.summary}`,
    `טקסט מקור: ${input.bodyText}`,
  ].join('\n');
}
