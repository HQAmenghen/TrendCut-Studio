# Coding Conventions

**Analysis Date:** 2026-04-17

## Naming Patterns

**Files:**
- Use `PascalCase.vue` for Vue components in `frontend/src/components/`, for example `frontend/src/components/TopNavigation.vue` and `frontend/src/components/MaterialDrivenWorkspace.vue`.
- Use `camelCase` with a `use` prefix for Vue composables in `frontend/src/composables/`, for example `frontend/src/composables/usePublishCenter.js` and `frontend/src/composables/useMaterialDriven.js`.
- Use descriptive lowercase or lower-camel filenames for Node modules in `server/`, grouped by role: routes like `server/routes/review.js`, services like `server/services/system/handlers.js`, and core utilities like `server/core/http.js`.
- Use `snake_case.py` for Python modules and scripts, for example `python/llm_client.py`, `python/gemini_client.py`, and `python/pipeline/run_material_driven.py`.

**Functions:**
- Use `createXxx...` for Node factory functions that assemble dependencies and return service objects, for example `createSystemHandlers` in `server/services/system/handlers.js`, `createPublishStore` in `server/services/publish/store.js`, and `createRecoveryService` in `server/core/recovery.js`.
- Use `registerXxxRoutes` for Express route registration helpers, for example `registerReviewRoutes` in `server/routes/review.js`.
- Use verb-first `camelCase` for utility helpers in Node, for example `sendError`, `readJsonIfExists`, `slugifyText`, and `sanitizePublishDescriptionText` in `server/core/http.js`, `server/core/runtime.js`, and `server/services/publish/store.js`.
- Use `snake_case` for Python functions and methods, for example `get_llm_provider`, `generate_content`, and `wait_for_file_ready` in `python/llm_client.py`.

**Variables:**
- Use `camelCase` for local variables, refs, and object properties in JS and Vue, for example `currentModuleTitle`, `publishCenter`, `errorState`, and `mockVerticalQueueService` in `frontend/src/App.vue`, `frontend/src/composables/usePublishCenter.js`, and `server/core/__tests__/recovery.test.js`.
- Use `UPPER_SNAKE_CASE` for shared constants, for example `LOG_FILE` in `server/core/logger.js`, `ERROR_CODES` in `server/core/errorCodes.js`, and `MATERIAL_DRIVEN_STORAGE_KEY` in `frontend/src/composables/useMaterialDriven.js`.
- Use `snake_case` for Python module-level constants when they behave as configuration, for example `DEFAULT_TIMEOUT_SECONDS` and `RETRYABLE_ERROR_MARKERS` in `python/gemini_client.py`.

**Types:**
- Use literal aliases or lightweight inline typing in Python instead of a dedicated type layer, for example `LLMProvider = Literal["gemini", "qwen"]` in `python/llm_client.py`.
- No TypeScript or shared interface files are present. In JS, shape contracts are expressed by naming, object literals, and helper functions such as `createError` in `server/core/errorCodes.js` and `normalizeApiError` in `frontend/src/composables/usePublishCenter.js`.

## Code Style

**Formatting:**
- Use ESLint from `.eslintrc.js` as the primary formatting authority for Node files under `server/` and `scripts/`.
- Apply these configured rules in JS:
  - 2-space indentation with `SwitchCase: 1`
  - single quotes
  - semicolons required
  - no trailing spaces
  - no dangling commas
  - at most 2 consecutive blank lines
- `console` is explicitly allowed by `.eslintrc.js` because the server relies on `server/core/logger.js` to persist logs.
- `frontend/` is not included in the `npm run lint` target, but sampled files like `frontend/src/main.js`, `frontend/src/composables/usePublishCenter.js`, and `frontend/src/composables/useMaterialDriven.js` mostly follow the same 2-space / semicolon style. Prefer matching that style when editing frontend code.
- `server.js` contains mixed indentation and quote usage relative to `.eslintrc.js`. Treat the linter config and the smaller modules under `server/` as the preferred style source.

**Linting:**
- Use `npm run lint` from `package.json` for server and script files only. It runs `eslint server/ scripts/ --ext .js`.
- Follow `eslint:recommended` plus repo-specific rules from `.eslintrc.js`:
  - `no-undef: error`
  - `no-unused-vars: warn` with `_`-prefixed arguments and variables ignored
  - `no-var: warn`
  - `prefer-const: warn`
  - `no-empty: error` with empty `catch` blocks allowed
  - `no-constant-condition: error` with loop checks disabled
- There is no detected Prettier or Biome config. Formatting is convention-driven and ESLint-backed for Node code.

## Import Organization

**Order:**
1. Platform or framework imports first.
2. Third-party packages second.
3. Relative local modules last.

**Observed patterns:**
- In CommonJS server files, built-ins usually come first, then package imports, then local modules. `server.js` and `server/core/logger.js` show the pattern clearly.
- In Vue files, external imports come first, then local components/composables, then side-effect CSS imports. See `frontend/src/main.js` and `frontend/src/App.vue`.
- Destructured imports are common for local helpers in Node, for example `const { sendError } = require('./server/core/http');` in `server.js`.

**Path Aliases:**
- Not detected. Use relative imports such as `./components/TopNavigation.vue`, `../taskStore`, and `./publishStore.config`.

## Error Handling

**Patterns:**
- Use the centralized JSON error envelope from `server/core/http.js`. Server handlers should call `sendError(res, { status, code, stage, error, details, hint })` instead of hand-building error responses.
- Prefer named error codes from `server/core/errorCodes.js`. The repo uses `createError(code, details, hint)` to attach a stable `code`, `stage`, and human-readable message.
- Wrap Express handlers in local `try/catch` blocks and translate failures into structured responses. `server/services/system/handlers.js` is the clearest example.
- Preserve fallback behavior for user-facing flows. `frontend/src/composables/usePublishCenter.js` normalizes backend failures through `normalizeApiError`, updates reactive error state, and appends the failure to in-memory logs.
- Treat non-critical browser persistence as best-effort. `frontend/src/App.vue` and `frontend/src/composables/useMaterialDriven.js` intentionally swallow `localStorage` read/write failures with `catch (_err) {}` comments.
- In Python, raise explicit exceptions for invalid configuration and return defaults only for optional reads. `python/llm_client.py` raises on unsupported providers, while `python/pipeline/run_material_driven.py` returns default payloads from JSON helpers when files are absent or malformed.

## Logging

**Framework:** `console` plus a server-side console shim.

**Patterns:**
- Keep `console.log`, `console.warn`, and `console.error` available in Node code. `server/core/logger.js` overrides the console methods and appends to `data/logs/server.log`.
- Use frontend in-memory log appenders for user-visible activity streams. `frontend/src/composables/usePublishCenter.js` stores recent lines in `recentLogs` and `errorLogs`.
- Use `print(...)` and `print(..., file=sys.stderr)` in Python scripts for runtime diagnostics and retry messages, as seen in `python/gemini_client.py` and `python/pipeline/run_material_driven.py`.
- Prefer short operational messages over structured logging payloads. The repo does not use a JSON logger or tracing library.

## Comments

**When to Comment:**
- Use comments for module intent, workflow steps, and edge-case rationale. Good examples:
  - module-level comments in `server/core/errorCodes.js`
  - test-goal comments in `server/services/publish/__tests__/scheduling.test.js`
  - inline rationale comments in `frontend/src/App.vue` and `frontend/src/composables/usePublishCenter.js`
- Keep comments concise and task-oriented. The codebase does not use dense explanatory comments for every line.

**JSDoc/TSDoc:**
- Full JSDoc is uncommon in JS modules.
- Python files rely on module docstrings and function docstrings instead, for example `python/llm_client.py` and `python/pipeline/run_material_driven.py`.

## Function Design

**Size:**
- Small utility functions are preferred in `server/core/` and `python/llm_client.py`.
- Larger orchestration functions are acceptable in composables and pipeline scripts when they own workflow state, for example `frontend/src/composables/useMaterialDriven.js` and `python/pipeline/run_material_driven.py`.

**Parameters:**
- Prefer dependency-object injection for Node services and handlers. `createSystemHandlers(deps)` and `createPublishStore(deps)` receive grouped dependencies instead of pulling everything from globals.
- Prefer options objects for JS helpers with optional behavior. `sendError(res, options = {})` and `generatePublishDescription(sourceText, options = {})` in `server.js` follow this pattern.
- Prefer explicit keyword-like parameters in Python public functions, for example `generate_content(client, *, model, contents, ...)` in `python/llm_client.py`.

**Return Values:**
- Return plain objects from service factories and utility helpers.
- Return reactive refs and methods from Vue composables, for example `usePublishCenter()` and `useMaterialDriven()`.
- Return booleans or default payloads from Python file helpers when the caller needs simple branching, for example `save_json_file()` and `load_json_file()` in `python/pipeline/run_material_driven.py`.

## Module Design

**Exports:**
- Use named object exports in CommonJS modules: `module.exports = { sendError }`, `module.exports = { ERROR_CODES, createError }`, and `module.exports = { registerReviewRoutes }`.
- Use named ESM exports in frontend composables: `export function usePublishCenter()` and `export function useMaterialDriven()`.
- Vue components use `<script setup>` and do not declare explicit export objects.

**Barrel Files:**
- Limited use. `server/services/review/index.js` acts as a small barrel that initializes storage and re-exports `createReviewHandlers`.
- Most directories do not use barrel files. Import from the concrete module path directly.

## Practical Guidance

- For new server code under `server/`, match `.eslintrc.js` exactly and prefer the patterns in `server/core/http.js`, `server/core/errorCodes.js`, and `server/services/system/handlers.js`.
- For new frontend code under `frontend/src/`, keep `PascalCase.vue` components and `useXxx.js` composables, and follow the existing Composition API style from `frontend/src/App.vue` and `frontend/src/composables/usePublishCenter.js`.
- For new Python scripts under `python/`, use `snake_case` filenames, docstrings, explicit environment reads, and lightweight typing as seen in `python/llm_client.py` and `python/gemini_client.py`.

---

*Convention analysis: 2026-04-17*
