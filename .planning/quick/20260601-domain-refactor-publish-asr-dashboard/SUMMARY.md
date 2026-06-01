---
title: Domain Refactor Publish ASR Dashboard
status: complete
completed_at: "2026-06-01T15:59:59+08:00"
---

# Summary

Completed a domain-level refactor of the publish center composable without changing the operator-facing UI flow.

## Changes

- Extracted publish center constants, normalization rules, account factories, account option builders, platform account labels, and platform card completeness calculation into `frontend/src/composables/publishCenter/domain.mjs`.
- Extracted automatic publishing schedule, mapping, configured-plan, generated-job, summary, and avatar preset display rules into `frontend/src/composables/publishCenter/autoPilot.mjs`.
- Kept `frontend/src/composables/usePublishCenter.js` focused on Vue reactive state, HTTP calls, mutation methods, and UI-facing wiring.
- Added `scripts/check-publish-center-domain.mjs` as a focused Node ESM check for the extracted pure frontend domain rules.

## Verification

- `node scripts/check-publish-center-domain.mjs`
- `npm run build:front`
- `npm run lint`
- `npm test -- --runInBand`
- `git diff --check` (only Windows LF-to-CRLF warnings)
