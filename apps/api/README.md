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

Phase 1 endpoints:

- `GET /health`: FastAPI process health.
- `GET /internal/health`: database and Redis dependency health.
- `GET /openapi.json`: generated FastAPI OpenAPI document.

Local commands:

- `pip install -r apps/api/requirements.lock.txt`
- `npm run migrate:api`
- `npm run start:api`
Phase 2 task endpoints:

- `POST /tasks`
- `GET /tasks`
- `GET /tasks/{task_id}`
- `POST /tasks/{task_id}/cancel`
- `POST /tasks/{task_id}/resume`
- `GET /tasks/{task_id}/steps`
- `GET /tasks/{task_id}/artifacts`

Task changes publish best-effort Redis messages to `trendcut.task-events`.
Phase 3 AI endpoints:

- `GET /ai/prompts`: list prompt registry entries and versions.
- `POST /ai/generate`: execute a governed AI capability and record an `llm_calls` row.

Supported initial capabilities: `title_generation`, `publish_copy`, `script_polish`, `material_score`, `video_review`.
Phase 4 Agent endpoints:

- `GET /agents/tools`: list tool registry, risk, and confirmation requirements.
- `POST /agents/runs`: create a structured agent run for a task.
- `GET /agents/runs/{run_id}`: read agent state.
- `POST /agents/runs/{run_id}/resume`: mark run resumable/running.
- `POST /agents/runs/{run_id}/tool-calls`: execute or block audited tool calls.
Phase 5 Worker endpoints:

- `GET /workers/types`: list supported worker job types and risk metadata.
- `POST /workers/jobs`: enqueue a worker job for an existing task.
- `GET /workers/jobs/{job_id}`: read worker job state.
- `POST /workers/jobs/lease`: worker lease endpoint.
- `POST /workers/jobs/{job_id}/heartbeat`: worker heartbeat endpoint.
- `POST /workers/jobs/{job_id}/complete`: record structured result and artifacts.
- `POST /workers/jobs/{job_id}/fail`: record structured error and optional retry.
- `POST /workers/jobs/{job_id}/cancel`: cancel queued/running work.
- `POST /workers/jobs/{job_id}/retry`: manually requeue recoverable work.
Phase 6 Publish endpoints:

- `POST /publish/jobs`: create a FastAPI-owned publish job.
- `GET /publish/jobs`: list publish jobs.
- `GET /publish/jobs/{publish_job_id}`: read publish state.
- `POST /publish/jobs/{publish_job_id}/confirm`: confirm high-risk publish/RPA action.
- `POST /publish/jobs/{publish_job_id}/dispatch`: enqueue `publish_worker` or `rpa_worker`.
- `POST /publish/jobs/{publish_job_id}/cancel`: cancel publish job and worker job.
- `POST /publish/jobs/{publish_job_id}/worker-complete`: worker result callback.
- `POST /publish/jobs/{publish_job_id}/worker-fail`: worker failure callback.
- `GET /publish/jobs/{publish_job_id}/audit`: read audit log.
- `GET /publish/accounts`: read account login/status records.
- `POST /publish/accounts/{platform}/{account_id}/login-check`: enqueue RPA login check.
