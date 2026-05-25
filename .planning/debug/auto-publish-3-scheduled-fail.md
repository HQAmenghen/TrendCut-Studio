---
status: fixed_awaiting_live_retry_verify
trigger: "检查相关日志为什么我设置的自动发布的3个定时任务都失败了，连视频都没有做好，排查原因，然后修复"
created: 2026-05-21T09:03:26+08:00
updated: 2026-05-21T10:05:37+08:00
---

# Debug Session: auto-publish-3-scheduled-fail

## Symptoms
- expected_behavior: "Three scheduled auto-publish tasks should run material/video generation successfully and proceed toward publishing."
- actual_behavior: "All three scheduled tasks failed before publish; the expected videos were not produced."
- error_messages: "Unknown at session start; inspect local server, scheduler, task, project, and publish logs."
- timeline: "Reported on 2026-05-21 Asia/Shanghai; inspect the most recent scheduled runs."
- reproduction: "Configured auto-publish schedules run through the local Comfy Panel Demo scheduler."

## Current Focus
- hypothesis: "Confirmed: scheduled auto-publish was blocked by brittle LLM/provider and optional downstream stages. The current code now gives LLM calls at least 5 attempts, then degrades only after the high-quality path is exhausted."
- test: "Self-verification passed with targeted Jest, ESLint, and Python unittest coverage; local Node service was restarted on port 3001 with the fixed code."
- expecting: "A new scheduled auto-publish run should continue to vertical rendering and publish task creation when DeepSeek title generation fails or reference-authority alignment cannot be satisfied, and transient LLM disconnects should receive at least 5 attempts first."
- next_action: "Run or compensate one real scheduled auto-publish workflow to confirm end-to-end behavior against live LLM/ASR/publish providers."
- reasoning_checkpoint:
  hypothesis: "Vertical queue optional enrichment failures caused completed avatar videos to stop before publish job creation because title generation and reference-authority subtitle alignment were fatal in the runtime code."
  confirming_evidence:
    - "Queue job 1779320760052_dq95d0h failed immediately after ASR with automatic title generation error DeepSeek 402 Insufficient Balance."
    - "Queue job 1779323040048_vm4kl15 failed after two strict reference-authority ASR attempts with REFERENCE_AUTHORITY_ALIGNMENT_FAILED / atom_span_not_contiguous:expected_0_got_1."
    - "Current queue.js diff catches generateHotTitle failures and uses a local fallback title, and reruns ASR without reference-authority args after strict alignment keeps failing."
  falsification_test: "A real scheduled auto-publish run on the current server code still marks the vertical queue job failed for automatic title generation 402 or REFERENCE_AUTHORITY_ALIGNMENT_FAILED instead of continuing."
  fix_rationale: "Both failed stages are enrichment/calibration stages, not required to produce a publishable vertical video; falling back to local title/subtitles preserves the operator workflow instead of aborting."
  blind_spots: "Rank 1 still failed earlier from Qwen RemoteDisconnected errors in material/avatar generation; that is provider/runtime instability and was not fully reproduced in this targeted verification."
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-21T09:09:59+08:00
  checked: "Debugger bootstrap requirements"
  found: "Loaded gsd-debugger contract, active debug session file, global gsd-debug skill index, and common bug pattern checklist. No project-local .claude/skills or .agents/skills directories were present."
  implication: "Proceed with the persisted session and global debugging workflow; likely pattern categories include Environment/Config, Async/Timing, Error Handling, and Data Shape/API Contract."

- timestamp: 2026-05-21T09:10:52+08:00
  checked: "Initial runtime artifact inventory"
  found: "No .planning/debug/knowledge-base.md content was found. Recent artifacts include large scheduler/server/vertical queue logs and recent projects material_1779320820042_e32b7b39, material_1779318900044_e33ca8b6, and material_1779318240495_beff4fa1. Broad grep over runtime data was too noisy because cookie/runtime JSON includes unrelated publish terms."
  implication: "Narrow investigation to recent log tails, task databases, and specific material project states."

- timestamp: 2026-05-21T09:11:45+08:00
  checked: "Scheduler/server log tails for 2026-05-21 scheduled autopilot run"
  found: "At 2026-05-20T23:04Z scheduler queued three avatar tasks. Rank 1 material_1779318240495_beff4fa1 failed at 23:14 with repeated qwen_client RemoteDisconnected errors. Rank 2 material_1779318900044_e33ca8b6 produced output_final.mp4 and was queued as vertical job 1779320760052_dq95d0h, but at 23:47:49 scheduler logged vertical status failed. Rank 3 material_1779320820042_e32b7b39 produced output_final.mp4 and was queued as vertical job 1779323040048_vm4kl15, but at 00:28 scheduler logged vertical status failed. Node one-liners for SQLite queries failed because PowerShell quoting produced invalid JS."
  implication: "Rank 1 is an external LLM/provider instability or retry-policy problem; ranks 2 and 3 require focused vertical queue investigation."

- timestamp: 2026-05-21T09:12:35+08:00
  checked: "Focused search setup for vertical failures"
  found: "The first exact rg search included many historical matches because it also searched generic failed/error terms across scheduler and server logs. SQLite query still failed because SQL string literals were converted into double-quoted identifiers."
  implication: "Use exact queue IDs for logs and avoid shell-embedded SQL quoting pitfalls by passing a short Node script through stdin."

- timestamp: 2026-05-21T09:13:30+08:00
  checked: "Vertical queue logs and durable task records for failed queue jobs"
  found: "Queue job 1779320760052_dq95d0h completed ASR/reference subtitle generation, then failed at title generation with DeepSeek 402 Insufficient Balance from generateHotTitle. Queue job 1779323040048_vm4kl15 failed during ASR/reference subtitle alignment after two attempts with REFERENCE_AUTHORITY_ALIGNMENT_FAILED / atom_span_not_contiguous:expected_0_got_1. Both failures are persisted in data/tasks.db. No publish jobs exist in python/publish/publish_jobs.db for these runs because vertical queue completion never happened."
  implication: "The auto-publish pipeline stops before publish creation when optional enrichment/subtitle calibration fails; read code to determine safe fallback points."

- timestamp: 2026-05-21T09:15:04+08:00
  checked: "server/services/vertical/queue.js implementation"
  found: "Current queue.js already contains code to catch generateHotTitle failures and use buildSafeFallbackTitle, and code to retry reference-authority ASR failures then rerun ASR without --reference-text-authority. This differs from the runtime failure behavior in logs, where those failures were fatal."
  implication: "Treat the current working tree as containing a likely partial/unverified fix; verify diff and add tests rather than assuming runtime is fixed."

- timestamp: 2026-05-21T09:15:54+08:00
  checked: "Git diff and test inventory"
  found: "server/services/vertical/queue.js has uncommitted changes adding local title fallback, plain-ASR fallback after reference authority failures, metadata title preservation, and fallback metadata flags. server/services/vertical/__tests__/queueAsrFileUrl.test.js already contains tests named 'falls back to normal ASR when strict reference authority keeps failing' and 'uses local fallback title when hot title generation fails'."
  implication: "Run the targeted vertical queue tests as verification before returning a checkpoint or completion."

- timestamp: 2026-05-21T09:16:53+08:00
  checked: "Targeted regression tests"
  found: "npx jest server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand passed: 1 suite, 8 tests. The suite includes the title fallback and strict reference-authority fallback cases. Test output includes an expected console.error from the simulated generate_title.py 402 failure."
  implication: "Self-verification confirms the current code handles the observed rank 2 and rank 3 vertical queue failure modes."

- timestamp: 2026-05-21T09:29:56+08:00
  checked: "LLM retry policy for high-quality path"
  found: "Qwen, DeepSeek, Gemini, and Vertex generation defaults are now 5 attempts. Their retry resolvers enforce a provider-specific minimum retry env var defaulting to 5, so callers passing retries=1 or retries=2 still get at least 5 attempts. Reference-authority subtitle LLM retries also clamp to a minimum of 5."
  implication: "The system now keeps the LLM quality path primary and only reaches fallback/degradation after at least 5 attempts or after provider/key failover is exhausted."

- timestamp: 2026-05-21T09:30:31+08:00
  checked: "Runtime activation"
  found: "The old node server process on port 3001 was restarted. The fixed server is listening on 127.0.0.1:3001 with PID 1504 and returned HTTP 200 for the frontend."
  implication: "New scheduled tasks will use the fixed retry and fallback behavior."

- timestamp: 2026-05-21T09:34:33+08:00
  checked: "Recoverability of the three failed run artifacts"
  found: "Rank 1 material_1779318240495_beff4fa1 recovers only to initial material state and needs material pipeline retry. Rank 2 material_1779318900044_e33ca8b6 and rank 3 material_1779320820042_e32b7b39 recover as completed material-driven outputs with output_final.mp4 present."
  implication: "Code fix is active, but the old failed vertical jobs will not automatically become autopilot publish jobs after restart because scheduler autopilot monitoring state is in memory; old runs need an explicit compensation/requeue flow if they should be published."

- timestamp: 2026-05-21T10:05:37+08:00
  checked: "Follow-up manual material and standalone failures around job 1779328139063_ef24e07f"
  found: "Two independent paths were failing at the same time. Manual material-driven job 1779328139063_ef24e07f ran score_material_segments.py in strict LLM mode without --allow-rule-fallback, so 8 of 12 Qwen batches failed after 5 retry attempts with RemoteDisconnected and the material pipeline aborted at step 3. At the same time, standalone imported-avatar ASR refreshed subtitles for material_1779320820042_e32b7b39 and failed strict reference-authority alignment with atom_span_not_contiguous:expected_0_got_1; this path was server/services/vertical/standalone.js, not the vertical queue path fixed earlier. DeepSeek stderr also showed key ****4f76 returning 402 Insufficient Balance, while Qwen failures were remote disconnects from keys ****0be6, ****a718, ****a2e4, and ****d680."
  implication: "The earlier fix covered auto-start and vertical queue but not manual material start or standalone import refresh. Those gaps are now patched: manual material tasks carry allowRuleFallback=true through pipelineProcess, and standalone reference-authority failures rerun normal ASR after strict retries are exhausted. The failed job already stopped before this fix and needs retry."

- timestamp: 2026-05-21T10:08:00+08:00
  checked: "Runtime activation for follow-up fix"
  found: "No run_material_driven.py, score_material_segments.py, or run_asr.py processes were active. The old node server.js process PID 22608 was stopped, and a new node server.js process PID 3024 is listening on 127.0.0.1:3001 with HTTP 200."
  implication: "New manual material and standalone vertical runs will use the updated fallback behavior."

## Eliminated

## Resolution
- root_cause: "The 2026-05-21 scheduled autopublish run had multiple brittle failure points. Rank 1 stopped during material/avatar generation because Qwen LLM calls repeatedly disconnected and strict LLM scoring did not allow a rule fallback. Rank 2 and rank 3 generated avatar output_final.mp4 files, but vertical queue treated optional downstream failures as fatal: rank 2 failed on DeepSeek 402 during automatic hot-title generation, and rank 3 failed on strict reference-authority subtitle alignment after repeated atom_span_not_contiguous errors. Because vertical jobs failed, publish jobs were never created."
- fix: "LLM generation retry minimums are now 5 attempts for Qwen, DeepSeek, Gemini, Vertex, and reference-authority subtitle alignment. AutoPilot material start passes --allow-rule-fallback after the LLM quality path is exhausted. Vertical queue now degrades gracefully: automatic title generation failures use buildFallbackTitleFromSubtitles/job metadata instead of failing, and persistent reference-authority subtitle alignment failures rerun ASR without reference-authority arguments and continue with ordinary ASR subtitles. Metadata records referenceSubtitleFallbackUsed and preserves existing title fields. The local server was restarted so the fix is active."
- verification: "Passed targeted Jest suite: npx jest server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/materialDriven/__tests__/retryPlan.test.js --runInBand (11 tests). Passed focused ESLint for changed server files. Passed Python unittests: python -m unittest python.tests.test_llm_key_failover python.tests.test_gemini_client and python -m unittest python.tests.test_run_asr_filetrans. Live end-to-end scheduled run still needs a real provider run or explicit compensation retry."
- files_changed:
  - "server/services/vertical/queue.js"
  - "server/services/vertical/__tests__/queueAsrFileUrl.test.js"
  - "server/services/materialDriven/autoStart.js"
  - "server/services/materialDriven/retryPlan.js"
  - "server/services/materialDriven/__tests__/retryPlan.test.js"
  - "python/qwen_client.py"
  - "python/deepseek_client.py"
  - "python/gemini_client.py"
  - "python/vertex_ai_client.py"
  - "python/llm_client.py"
  - "python/pipeline/run_asr.py"
  - "python/tests/test_llm_key_failover.py"
  - "python/tests/test_gemini_client.py"
