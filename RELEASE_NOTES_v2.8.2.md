# HilTech Zoho Content Bot v2.8.2 — Source Timeline Resolver

## Why
The former scanner collected generic Zoho blog/archive links and then rejected them as old. It did not reliably inherit the month/year shown in the official Zoho “What’s New” timeline.

## Changes
- Replaced generic candidate collection with a source-scoped update collector.
- Resolves month/year labels from update cards, parent timeline sections, headings, and preceding timeline siblings.
- Filters candidates before fetching detail pages: only official updates with an inferred 2026+ date are processed.
- Avoids fallback to generic archive/footer links when a source has no dated current cards.
- Adds scanner diagnostics:
  - collected candidates
  - eligible 2026 candidates
  - sample title/date/URL records

## Expected log
`Zoho source timeline candidates resolved` with `eligible2026 > 0` when a source exposes a dated 2026 update.
