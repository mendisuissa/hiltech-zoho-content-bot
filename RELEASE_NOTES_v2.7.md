# HilTech Zoho Content Bot v2.7

## Review experience
- Preview now uses visually separated Telegram panels rather than one dense message.
- Each channel is sent as its own readable review card.
- Source date and official Zoho link are shown under every preview card.
- Review controls remain after the cards.

## Current updates only
- Existing pending approvals with no official date or a date before 2026 are blocked from resend, preview, and regeneration.
- Newly scanned items already require an official 2026+ date.

## Branded covers
- The generated background is now passed through `applyHilTechBranding()` before it is sent to Telegram.
- The real `assets/hiltech-logo.png` is composited on the actual image, not merely described in caption text.
