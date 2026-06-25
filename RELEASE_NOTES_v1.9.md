# HilTech Zoho Content Bot v1.9 — Editorial Quality Pipeline

## New specialist teams
- **Editorial Agent:** selects the correct audience, content type and Hebrew angle before writing.
- **Writer Agent:** creates the article and the 3 channel-specific posts using HilTech Style DNA.
- **Fact Check & QA Agent:** compares claims to the official Zoho source and scores factual accuracy, editorial quality, style and social copy.
- **Design QA Agent:** checks WordPress-ready structure: H2 sections, HTML paragraphs, text length, SEO title and meta description.

## Quality gate
The pipeline allows one automatic rewrite when QA reports required fixes. Telegram cards and Preview show a real QA status and score. The bot still never publishes automatically.

## Database
`prisma db push` creates the additional QA columns automatically during deployment.
