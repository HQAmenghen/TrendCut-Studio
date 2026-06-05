# Phase 3: AI Capabilities

## Goal

Move lightweight AI calls behind FastAPI governance so prompt versions, model fallback, traces, token/cost estimates, and call records are centralized.

## Changes

- Added Prompt Registry with initial capabilities: `title_generation`, `publish_copy`, `script_polish`, `material_score`, and `video_review`.
- Added `llm_calls` Alembic migration and SQLAlchemy model.
- Added FastAPI `GET /ai/prompts` and `POST /ai/generate`.
- Added LiteLLM/OpenAI-compatible call path controlled by `LITELLM_BASE_URL` and `LITELLM_API_KEY`.
- Added model-order fallback via `LLM_MODEL_ORDER`.
- Added deterministic `local_template` fallback so local/dev tests do not depend on external LLM keys.
- Added `packages/sdk/src/ai-client.ts` and BFF `/ai` proxy endpoints.

## Review Notes

- The AI control plane now records every new AI call attempt in `llm_calls`, including failed model attempts before fallback.
- Token and cost fields are estimates/placeholders until provider-specific usage accounting is wired in.
- Existing Express/Python AI call sites are not removed yet; future migrations should route each lightweight capability through `/ai/generate`.
- The local template provider is explicitly marked as `needs_external_llm` and should not be used as final production quality output.

## Verification

- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- FastAPI SQLite smoke: `/ai/prompts` 200, `/ai/generate` 200 with `local_template`, `llm_calls` row count 1.
- Temporary FastAPI+BFF process smoke: BFF `/ai/generate` returned `local_template` with prompt version `publish_copy.v1`.
