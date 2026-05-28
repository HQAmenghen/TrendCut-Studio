# Quick Task 260519-fgb: V0 Agent API + MCP Server

## Goal

Build a local self-test V0 that lets Codex/ClaudeCode drive the existing Comfy Panel workflow through a narrow agent surface and a local MCP server.

## Tasks

1. Add `/api/agent/v1` service and route modules with token auth, audit logging, capability metadata, post search, generation, job status, review, publish draft, and guarded publish confirm.
2. Wire the agent service into `server.js` using existing xAI, material-driven, review, publish, and self-check capabilities without broad internal rewrites.
3. Add `mcp-server/` with MCP tools that forward to `/api/agent/v1` using `AGENT_API_TOKEN`.
4. Add focused Jest tests for auth, search, idempotency, and publish safety.

## Verification

- `npm test -- server/services/agent/__tests__/handlers.test.js`
- `npm run lint -- --quiet`

