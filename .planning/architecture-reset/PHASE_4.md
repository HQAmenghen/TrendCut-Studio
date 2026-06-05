# Phase 4: Agent Layer

## Goal

Introduce a resumable, auditable Agent control plane with structured state and a permissioned tool registry.

## Changes

- Added FastAPI Agent endpoints for tool registry, run create/read/resume, and tool calls.
- Added `tool_registry.py` with risk metadata and confirmation requirements.
- Added `agent_service.py` to write `agent_runs` and `tool_calls` records.
- Added safe tool execution for `ai.generate` and `task.read`.
- Added high-risk blocked tools for `publish.execute` and `file.delete` until explicit confirmation is supplied.
- Added BFF `/agents` proxy endpoints and SDK `agent-client.ts`.

## Review Notes

- No CrewAI or subagent runtime is introduced.
- Agent output is structured state/tool-call records, not free-form natural language only.
- High-risk tools are blocked and audited by default.
- Tool implementations that mutate external state remain deferred to worker/RPA phases.
- LangGraph can be wired behind this API later without changing the BFF contract.

## Verification

- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- FastAPI SQLite smoke: tools 200, run created, `publish.execute` blocked, `ai.generate` succeeded through governed AI, resume running.
- Temporary FastAPI+BFF process smoke: BFF run create 201, BFF high-risk tool call 200 blocked.
