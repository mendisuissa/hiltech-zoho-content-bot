# v2.9 – Zoho Projects Timeline Parser

## What changed
- Replaced the generic link scraper for Zoho Projects with a timeline-card parser.
- Reads the official What’s New page in document order: year -> month -> update title -> category -> summary -> Read More.
- Supports official `help.zoho.com`, `www.zoho.com`, `zoho.com`, and `blog.zoho.com` links where appropriate.
- Keeps the official timeline date from the source page as `publishedAt`, so Help articles do not need to expose their own publish date.
- Skips generic blog cards in the Projects timeline.
- Adds Docker asset copy so `assets/hiltech-logo.png` is available at runtime for cover branding.

## Expected scan log
`Zoho Projects timeline cards parsed` should show `eligible2026` greater than zero when the live Zoho Projects page contains current 2026 updates.
