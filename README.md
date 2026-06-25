# HilTech Zoho Content Bot

Cloud-based Hebrew content automation for HilTech. It scans only official Zoho updates for **Zoho CRM**, **Zoho Projects**, and **Zoho Desk**.

## v1 workflow

1. Scan official Zoho sources twice daily.
2. Score and deduplicate updates.
3. Generate a Hebrew article plus Facebook Page, Facebook Group, and WhatsApp drafts.
4. Send an approval request to Telegram.
5. After approval, send the complete content pack to Telegram.
6. HilTech uploads the article manually to WordPress. No WordPress credentials and no automatic publishing are used in v1.

## Required configuration for scanning

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_APPROVER_CHAT_ID`
- `SCAN_SECRET`

`GET /health` intentionally starts without external integrations so Railway can validate the service before the configuration is complete.

## Sources

- https://www.zoho.com/crm/whats-new/release-notes.html
- https://www.zoho.com/projects/whats-new.html
- https://www.zoho.com/desk/release-notes.html

## API

- `GET /health` — deployment health endpoint.
- `POST /api/scan/run` — scans sources; requires `x-scan-secret`.
- `GET /api/approvals/pending` — lists pending content packs.
- `GET|POST /api/approvals/:id/approve?token=...` — approves and sends content to Telegram.
- `GET|POST /api/approvals/:id/reject?token=...` — rejects an item.

## Railway

1. Create a Railway PostgreSQL service and expose its `DATABASE_URL` to this service.
2. Add the variables in `.env.example` (except the unused Facebook variables).
3. Set `APP_BASE_URL` to the public Railway domain.
4. Run Prisma migrations once: `npx prisma migrate deploy`.
5. Configure a scheduler to call `POST /api/scan/run` twice daily with the `x-scan-secret` header, or set `ENABLE_LOCAL_SCHEDULER=true` for one always-on instance.

## Local commands

```bash
npm install
npm run prisma:generate
npm run build
npm test
```


## Telegram approval buttons

The bot sends each candidate to the shared Telegram approval group with three inline buttons:

- **Preview** — sends a concise preview of the article and each social draft.
- **Approve & send** — marks the candidate approved and delivers the full content pack to the group.
- **Reject** — closes the candidate without publishing anything.

After deployment, register the Telegram webhook once. Set `APP_BASE_URL` to the Railway public URL and set `TELEGRAM_WEBHOOK_SECRET` to a long random value. Then run this from PowerShell (do not paste your token into chat):

```powershell
$token = "YOUR_TELEGRAM_BOT_TOKEN"
$secret = "YOUR_TELEGRAM_WEBHOOK_SECRET"
Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$token/setWebhook" `
  -Body @{ url = "https://YOUR-RAILWAY-DOMAIN/api/telegram/webhook"; secret_token = $secret }
```

Telegram buttons work only from the configured `TELEGRAM_APPROVER_CHAT_ID` group.

## v1.4 – Full content package and QA

Each candidate now creates a complete Hebrew content package before approval:

- SEO title, slug, meta description and article summary
- WordPress-ready article draft (manual upload only)
- Facebook Page post focused on business efficiency, sales and service
- Zoho-focused Facebook Group post
- Short WhatsApp Group draft for Zoho CRM, Zoho Projects or Zoho Desk
- Official Zoho source link
- Internal QA score and a short QA report
- Cover-image concept in preview; the Telegram **🖼 יצירת קאבר** button generates a 16:9 cover image through OpenAI and sends it to the management group.

The image action consumes OpenAI image credits and does not publish anywhere automatically.


## Re-send pending Telegram approvals

After deploying a new Telegram layout, re-send existing pending approval cards without rescanning Zoho:

```bash
curl -X POST "https://YOUR_DOMAIN/api/approvals/resend-pending?limit=3" \
  -H "x-scan-secret: YOUR_SCAN_SECRET"
```

Use `limit=1` to test the first card, then increase the limit as needed.

## v1.7 — HilTech Style DNA
Content prompts now apply an internal HilTech Hebrew editorial guide: practical explanations, clear heading-led article structures, a distinct business-owner/implementer path, product-specific social copy, and strict source-grounding rules. Existing approval records keep their already-generated drafts; run a new scan on future source items to use the new style.


## v1.8 notes
- Telegram approval cards now prefer the generated Hebrew article title instead of the raw English Zoho title.
- Approval cards show a Hebrew summary and move the original Zoho title to a small source note.
- New approvals store the generated Hebrew title as the approval title.


## v1.9 Editorial Quality Pipeline
Every candidate is reviewed by: Editorial Agent → Writer Agent → Fact Check & QA Agent → WordPress Design QA.
The QA agent compares content to the official Zoho source and performs one automatic rewrite when required. Telegram cards and Preview show the QA status and score. No automatic publishing is enabled.

## HilTech cover branding
Generated cover backgrounds are intentionally created without text or logos. The service then overlays the supplied `assets/hiltech-logo.png` in the upper-right corner using Sharp, so the real HilTech logo remains exact and readable.


## v2.5 Telegram review flow
Every preview and regenerated package ends with a dedicated action panel: show package, rewrite, approve/send, reject, and create cover. This keeps review controls visible even when the content is long.
