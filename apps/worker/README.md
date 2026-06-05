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
