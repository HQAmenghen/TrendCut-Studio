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
- The first executor is an adapter that records structured manifests for ASR, material scoring, script, clip plan, render, review, publish, and RPA job types.
- High-risk publish/RPA jobs require `confirmed=true` and are hardened in Phase 6.
