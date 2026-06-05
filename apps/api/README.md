# TrendCut API

FastAPI service home.

Responsibilities:

- Task control plane.
- AI calls and provider selection.
- Agent orchestration.
- Worker dispatch.
- Tool execution API boundaries.
- Durable records for tasks, task steps, artifacts, agent runs, tool calls, and LLM calls.

Rules:

- This service owns the canonical task lifecycle.
- Browser clients must reach it through the NestJS BFF.
- Long-running work must be delegated to workers once Phase 2 starts.
