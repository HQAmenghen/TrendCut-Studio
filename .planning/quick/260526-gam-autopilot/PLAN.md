# Quick Task 260526-gam: Improve AutoPilot Success Rate

## Goal

Increase scheduled AutoPilot success rate without bypassing content safety checks.

## Scope

- Add batch-level retry around material segment LLM scoring failures.
- Add AutoPilot avatar slot replacement so a failed source can be replaced by the next ranking item for the same publish slot.
- Add focused scheduler regression coverage for replacement behavior.

## Verification

- Run targeted scheduler tests.
- Run Python syntax checks for touched pipeline files.
