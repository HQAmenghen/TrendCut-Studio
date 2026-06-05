# Post-Review Hardening

## Findings Addressed

- FastAPI was exposed on the host through Docker Compose.
- BFF accepted untyped `Record<string, unknown>` payloads and forwarded caller-provided actors.
- Publish/RPA risk confirmation was a workflow field but not a meaningful boundary.
- Worker executor wording overstated real video/RPA migration.
- BFF default runtime did not serve frontend static assets.
- Redis worker queue semantics were overstated.

## Changes

- Removed FastAPI host port publishing from `docker-compose.yml`; `api:8000` is internal Compose networking only.
- Added FastAPI internal token dependency for task, AI, agent, worker, and publish routers.
- Added internal token propagation from NestJS SDK clients and Python worker client.
- Added BFF request guard with optional API token, simple per-minute rate limit, and request actor context.
- Added BFF error standardization filter.
- Added BFF DTO validation for task and publish entrypoints.
- Changed publish confirm/dispatch/cancel/login-check BFF endpoints to derive actor from request context.
- Updated BFF runtime and Dockerfile to serve `frontend-dist`.
- Updated architecture and phase notes to state that worker/RPA execution is currently adapter-based and Redis is a wakeup/event channel, not the authoritative broker.

## Review Notes

- This is a boundary hardening pass, not full enterprise auth. Next hardening step is replacing `BFF_API_TOKEN`/headers with real sessions, RBAC, tenant scopes, and signed high-risk confirmations.
- FastAPI remains callable from the Compose network by BFF and worker only with `x-trendcut-internal-token`.
- Concrete FFmpeg/Playwright execution still belongs behind the worker adapter contract.

## Verification

- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- FastAPI internal-token smoke: passed; `/tasks` rejects missing/wrong token and accepts the configured token.
- BFF DTO/auth/actor smoke: passed; missing `BFF_API_TOKEN` rejected, invalid task DTO returned 400, publish confirmation actor came from `x-user-id` rather than body.
- Worker runner smoke with internal token: passed; worker leased and completed a job through protected FastAPI endpoints.
- `npm run ci`: passed; legacy scheduler lint warnings remain warning-only and pre-existing.
