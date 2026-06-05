# TrendCut Workers

Python worker home.

Responsibilities:

- ASR and material scoring.
- Script and clip planning.
- Rendering.
- Review.
- Publish and RPA execution.
- External tool calls that require Python runtimes.

Rules:

- Workers consume jobs from the queue.
- Workers report structured task-step, artifact, and error events.
- Workers must support cancel, retry, resume, timeout, and manual takeover where the job type requires it.

Phase 5 runtime:

- `python -m trendcut_worker.runner --once` leases one job from FastAPI and exits.
- `python -m trendcut_worker.runner` polls continuously.
- Worker state is reported through FastAPI `/workers/jobs/*`; stdout is not a control protocol.
- `script_worker` and `clip_plan_worker` run legacy Python skills in-process and record structured skill output.
- `asr_worker`, `material_score_worker`, `render_worker`, `review_worker`, `publish_worker`, and `rpa_worker` invoke their legacy Python CLI entrypoints through the worker runtime with protocol-event capture.
- Job manifests are still written for audit, but they now wrap real execution results instead of replacing execution.
- High-risk publish/RPA jobs require `confirmed=true` and are hardened in Phase 6.
- Workers lease jobs through FastAPI HTTP; Redis is currently a wakeup/event hint, not the authoritative queue broker.
- Worker calls to FastAPI must include `INTERNAL_API_TOKEN`.
