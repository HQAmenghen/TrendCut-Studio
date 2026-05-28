---
status: resolved
trigger: "Standalone vertical output for task standalone_1779951634136_5d551141 has narration script with stale 2025 wording for a Trump/Bitcoin/USD pressure finance short on 2026-05-28."
created: 2026-05-28
updated: 2026-05-28
---

# Debug Session: standalone-script-stale-year

## Symptoms

- Expected behavior: The voiceover/script generation stage should use current, verified information for time-sensitive finance/news topics and avoid stale year expressions such as 2025 when the runtime date is 2026-05-28.
- Actual behavior: The generated narration for `竖屏合成成片｜特朗普突然改口 比特币真能减轻美元压力？` contains an incorrect 2025-era expression.
- Error messages: None observed; this is a semantic freshness/fact-accuracy defect.
- Timeline: Observed in a standalone vertical output updated 2026-05-28 15:08:52 at `data\uploads\runtime_jobs\standalone_1779951634136_5d551141\standalone_output_vertical.mp4`.
- Reproduction: Generate or inspect a standalone vertical task using a time-sensitive Trump/Bitcoin/USD-pressure topic and trace the script/narration-generation stage.

## Current Focus

- hypothesis: The standalone narration/script prompt relied on model prior knowledge or stale input summaries without a required live search/freshness context for time-sensitive topics, and the later polish pass could reintroduce stale timing language.
- test: Locate the script-generation stage, confirm whether live retrieval is available, add a freshness context/search step, pass it through rewrite and polish, and add regression coverage for 2026 date anchoring.
- expecting: Script generation receives explicit current-date and sourced fresh-context instructions before producing narration for news/finance topics.
- next_action: resolved
- reasoning_checkpoint: Root cause found in script rewriting before standalone rendering; stale wording was already persisted in runtime `narration.json`.
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-28T15:xx:xx+08:00
  observation: `data\uploads\runtime_jobs\standalone_1779951634136_5d551141\narration.json` contains `已经让比特币的叙事在2025年开年被重新定义`; the same text propagated into `audio.json`, `reference_subtitles.json`, `subtitles.json`, and final `.meta.json`.
- timestamp: 2026-05-28T15:xx:xx+08:00
  observation: `original_context.json` only contained the Trump/Bitcoin/USD-pressure quote and no 2025 wording, so the stale year was introduced by LLM script rewriting rather than source ingestion.
- timestamp: 2026-05-28T15:xx:xx+08:00
  observation: `server/services/vertical/standalone.js` writes `req.body.script` or imported material narration into runtime `narration.json`; standalone vertical rendering consumes existing script text and does not generate the stale phrase itself.
- timestamp: 2026-05-28T15:xx:xx+08:00
  observation: `python/pipeline/skills/script_rewriter_skill.py` generated narration from source/post/video context through ordinary text LLM prompts without required current-date/live-search context for time-sensitive finance/news topics.
- timestamp: 2026-05-28
  observation: Added per-run `fresh_context.json` generation in `run_material_driven.py`; time-sensitive source posts call xAI Responses with `x_search` when `XAI_API_KEY` is configured and persist status/error/current date even when search is unavailable.
- timestamp: 2026-05-28
  observation: `ScriptRewriterSkill` and `ScriptPolisherSkill` now receive the same freshness context, so the rewrite stage and second-pass polish stage share one current-date/search boundary.
- timestamp: 2026-05-28
  observation: Prompt templates now rank `联网事实保鲜` above source text for current-date/latest-fact calibration and explicitly forbid unsupported stale anchors such as `2025年开年`.

## Eliminated

- hypothesis: The stale year was introduced by ASR, subtitle alignment, or vertical rendering.
  evidence: The stale phrase is present in `narration.json`, which is upstream of speech, ASR reference subtitles, and final vertical render.

## Resolution

- root_cause: The material-driven narration rewriter could generate time-sensitive finance/news commentary from model priors and sparse source text, with no auditable live freshness check or current-date guardrail; standalone vertical then faithfully reused that stale narration.
- fix: Added `pipeline.skills.fresh_context` for xAI `x_search` freshness checks, persisted per-run `fresh_context.json`, passed the same context into `ScriptRewriterSkill` and `ScriptPolisherSkill`, updated rewrite/combined/polish prompts with current-date and stale-year constraints, and added regression coverage for the 2026 Trump/Bitcoin case.
- verification: `python -m unittest python.tests.test_script_rewriter_skill python.tests.test_script_polisher_skill python.tests.test_material_driven_pipeline`; `python -m py_compile python\pipeline\skills\fresh_context.py python\pipeline\skills\script_rewriter_skill.py python\pipeline\skills\script_polisher_skill.py python\pipeline\run_material_driven.py`; `git diff --check` for touched files.
- files_changed: `python/pipeline/skills/fresh_context.py`; `python/pipeline/skills/script_rewriter_skill.py`; `python/pipeline/skills/script_polisher_skill.py`; `python/pipeline/run_material_driven.py`; `python/pipeline/prompt_skills/script_rewriter_skill.md`; `python/pipeline/prompt_skills/script_rewriter_combined_skill.md`; `python/pipeline/prompt_skills/script_polisher_skill.md`; `python/tests/test_script_rewriter_skill.py`; `python/tests/test_script_polisher_skill.py`; `python/tests/test_material_driven_pipeline.py`; `.planning/debug/standalone-script-stale-year.md`
