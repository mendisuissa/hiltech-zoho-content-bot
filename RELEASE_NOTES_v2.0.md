# HilTech Zoho Content Bot v2.0 — Zoho Updates Intelligence

## Purpose
v2.0 changes the editorial objective from general Zoho marketing content to a Hebrew update-intelligence pipeline for Zoho CRM, Zoho Projects and Zoho Desk.

## Changes
- Editorial brief extracts a source-grounded change log with evidence, importance, update type, availability notes and limitations.
- Articles are required to explain what changed first, what it enables second, and practical checks last.
- QA blocks approval when meaningful source changes are omitted, unsupported claims are made, or the output becomes generic product promotion.
- WhatsApp and Facebook Group content are update-first and product-specific.
- Unknown rollout, licensing and limitation data must be described as not specified by the source instead of guessed.

## Upgrade
Run the existing Railway start command:

`npx prisma db push && node dist/src/server.js`

No new environment variables are required.
