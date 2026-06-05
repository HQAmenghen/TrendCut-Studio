# Phase 7: Express Shutdown

## Goal

Make NestJS BFF the default application entry and demote Express to explicit legacy-only operation.

## Changes

- Changed `npm start` to run the NestJS BFF.
- Added `npm run start:legacy` as the only supported local Express startup path.
- Added a startup guard to `server.js`; direct `node server.js` exits unless `ENABLE_LEGACY_EXPRESS=true`.
- Moved the legacy Express Docker Compose service behind the `legacy` profile.
- Updated Vite dev proxy so new API prefixes (`/tasks`, `/ai`, `/agents`, `/workers`, `/publish`) go to NestJS BFF.
- Kept `/api/*` proxied to Express only for archived legacy UI paths that are not yet deleted from the repository.
- Strengthened `check:legacy-boundary` so CI fails if `npm start` points back at Express.

## Review Notes

- Express route files are not deleted in this branch because legacy tests and archived UI paths still depend on them for reference coverage.
- Express is no longer the default runtime path for new architecture work.
- New APIs remain under NestJS/FastAPI; direct frontend access to FastAPI is still prohibited.
- The separate stable worktree can continue running the legacy app without being affected by this branch.

## Verification

- `npm run check:legacy-boundary`: passed.
- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- `npm start` BFF smoke: passed on port 3140.
- `node server.js` guard smoke: passed; direct Express startup exits with code 1.
- `npm run start:legacy` legacy smoke: passed on port 3141.
- Docker Compose YAML parse: passed; default services are `postgres`, `redis`, `api`, `bff`, `worker`, with `legacy-express` behind the `legacy` profile.
- `npm run ci`: passed. Existing legacy lint warnings in `server/services/system/schedulerAutoPilot.js` remain warning-only.
