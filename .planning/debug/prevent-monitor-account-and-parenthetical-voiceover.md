---
status: resolved
trigger: "Material-driven tasks such as projects/material_1779059038866_973884d7 include monitoring/source account names and parenthesized English annotations in Chinese voiceover."
created: 2026-05-18
updated: 2026-05-18
---

# Debug Session: prevent-monitor-account-and-parenthetical-voiceover

## Symptoms

- Expected behavior: Chinese voiceover directly discusses the video/interview content, preserving real people and organizations mentioned in the content, while never reading monitoring/source account handles.
- Actual behavior: the generated narration for `projects/material_1779059038866_973884d7` starts with `BMNRBullz账号分享...` and includes a parenthesized English gloss `（THE BIGGEST RALLY OF OUR LIFETIME）` that TTS reads aloud.
- Error messages: none; output quality/prompt-constraint failure.
- Timeline: observed in repeated material-driven X/Twitter monitoring tasks.
- Reproduction: inspect `source_post.json` and `narration.txt` for `projects/material_1779059038866_973884d7`.

## Current Focus

- hypothesis: Script rewriting/polishing prompts treat `source_post.author` and leading `@handle -` post text as highest-priority content, and local validation does not reject source-account mentions or parenthetical English glosses.
- test: Add focused regression coverage for source-account stripping, source-account mention detection, real person preservation, parenthetical gloss removal, and polisher repair retry.
- expecting: Prompt payloads exclude source account metadata, generated voiceover rejects account leaks/glosses, and real video people such as Tom Lee remain allowed.
- next_action: resolved

## Evidence

- timestamp: 2026-05-18T15:01:34+08:00
  observation: `source_post.json` for the reported task contains `author: BMNRBullz` and body beginning `@BMNRBullz - ... Tom Lee ...`.
  implication: The LLM was handed the monitoring account as normal high-priority source text.
- timestamp: 2026-05-18T15:01:34+08:00
  observation: `narration.txt` begins `BMNRBullz账号分享Tom Lee最新判断` and contains `（THE BIGGEST RALLY OF OUR LIFETIME）`.
  implication: Both reported failure modes are present in the generated canonical narration.
- timestamp: 2026-05-18T15:05:00+08:00
  observation: `script_rewriter_skill.md`, `script_rewriter_combined_skill.md`, and `script_polisher_skill.md` did not explicitly separate monitoring/source accounts from real content entities.
  implication: Prompt constraints were insufficient to tell the model that source accounts are metadata only.
- timestamp: 2026-05-18T15:08:00+08:00
  observation: `ScriptRewriterSkill._normalize_source_post()` exposed `author` in prompt source JSON, and validation only checked topic/source coverage, out-of-scope terms, and AI-template phrases.
  implication: Even when prompts failed, no local guard rejected `BMNRBullz账号分享...` or parenthesized English annotations.

## Eliminated

- hypothesis: Real content people need to be removed along with account names.
  reason: Tests confirm `Tom Lee` remains allowed while `BMNRBullz` is treated as a forbidden source account; an `elonmusk` handle does not reject the spaced real person name `Elon Musk`.

## Resolution

- root_cause: Source account metadata and leading `@handle` text were fed into the script writer as high-priority source content, and neither the prompts nor local validation distinguished monitoring account names from real people in the video/interview. Parenthetical English glosses were also not forbidden or stripped before TTS.
- fix: Prompt payloads now strip leading source handles and omit author metadata, prompts explicitly forbid source-account attribution and parenthetical English/translation glosses, rewriter/polisher validation detects source account leaks and parenthetical glosses, and repair prompts force removal when a model violates those constraints.
- verification: `python -m unittest python.tests.test_material_driven_pipeline python.tests.test_script_rewriter_skill python.tests.test_script_polisher_skill` passed; `python -m py_compile python\pipeline\skills\script_rewriter_skill.py python\pipeline\skills\script_polisher_skill.py` passed.
- files_changed: `python/pipeline/skills/script_rewriter_skill.py`; `python/pipeline/skills/script_polisher_skill.py`; `python/pipeline/prompt_skills/script_rewriter_skill.md`; `python/pipeline/prompt_skills/script_rewriter_combined_skill.md`; `python/pipeline/prompt_skills/script_polisher_skill.md`; `python/tests/test_script_rewriter_skill.py`; `python/tests/test_script_polisher_skill.py`; `.planning/debug/prevent-monitor-account-and-parenthetical-voiceover.md`
