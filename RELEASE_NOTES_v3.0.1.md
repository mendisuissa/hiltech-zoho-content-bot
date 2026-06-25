# HilTech Zoho Content Bot v3.0.1

## Verified Zoho Projects DOM parser fix

- Parses the actual Zoho Projects What’s New card structure:
  `.event-category-year-wrap > .event-category-wrap > .event-category`.
- Reads year from `h2`, month from `h3`, title from `.head h4`, summary from `.whatsnew-desc p`, and official source from `.read-more`.
- Supports official `help.zoho.com` links.
- Fixture now mirrors the real DOM captured on 2026-06-25.

## Validation

- `npm test -- tests/zohoProjectsParser.test.ts`: passed (3/3).
- Full TypeScript build must be run after `npx prisma generate`; this container could not download Prisma’s engine because external DNS was unavailable.
