# v3.0 — Parser Test Gate

- Adds a deterministic Zoho Projects 2026 timeline fixture and parser unit test.
- Adds an opt-in live parser smoke test: `npm run test:zoho-live`.
- Exports the Projects timeline parser for direct verification.
- The deployment gate is now `npm test && npm run build`; the live test should be run when source markup changes.
