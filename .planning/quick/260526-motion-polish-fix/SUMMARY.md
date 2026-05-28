---
status: complete
created: 2026-05-26
updated: 2026-05-26
---

# Motion Polish Fix Summary

Adjusted running-state motion so it is visible and stable:
- moved shimmer to the full progress rails instead of tiny filled spans;
- removed transform scaling from the Production progress ring;
- kept a stable glow pulse for active rings and cards.

Verification:
- `npm run build:front`
- Browser smoke check for rail shimmer and ring glow CSS.
