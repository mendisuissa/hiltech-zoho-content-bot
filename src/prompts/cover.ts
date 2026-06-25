type CoverPromptInput = {
  title: string;
  summary: string;
  product: string;
  audience: string;
  editorialBrief?: { hebrewTitle?: string; hebrewSummary?: string; angle?: string };
};

export function buildCoverPrompt(input: CoverPromptInput): string {
  return [
    'Create a JSON-only cover-image concept for a Hebrew HilTech article about Zoho.',
    'Do not include any text, logos, brand names, UI screenshots, people, or watermarks in the generated background. The exact HilTech logo is added afterward by the publishing pipeline.',
    'The visual style must align with HilTech branding: deep navy background, teal / mint accents, restrained white highlights, clean premium enterprise workflow imagery, warm professional lighting, 16:9 landscape.',
    'Return only valid JSON with: { "prompt": string, "altText": string }.',
    'The prompt must be in English and clearly describe an original image suitable for a WordPress article cover.',
    input.editorialBrief ? `Editorial angle: ${input.editorialBrief.angle ?? input.editorialBrief.hebrewSummary ?? ""}` : "",
    `Product: ${input.product}`,
    `Audience: ${input.audience}`,
    `Source title: ${input.title}`,
    `Summary: ${input.summary}`,
  ].join('\n');
}
