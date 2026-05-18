---
status: awaiting_human_verify
trigger: "User set login detection interval to 600 minutes but login checks still run frequently."
created: 2026-05-18
updated: 2026-05-18T11:11:17+08:00
---

# Debug Session: login-check-frequency

## Symptoms

- Expected behavior: Login status check should run about once every 600 minutes when configured that way.
- Actual behavior: Login status checks still appear to run frequently.
- Error messages: None provided.
- Timeline: Current behavior observed by user.
- Reproduction: Configure login detection interval to 600 minutes and observe repeated login checks.

## Current Focus

- hypothesis: Fixed root cause is cron minute-field scheduling; login checks now use a minutely scheduler tick with an elapsed-interval gate, so 600 means 600 elapsed minutes.
- test: Self-verified with scheduler regression tests and lint.
- expecting: In a real server run, a 600 minute setting should not start another scheduled login check until 10 hours have elapsed since scheduler startup or the previous scheduled check.
- next_action: Human-verify by running the console with `LOGIN_CHECK_INTERVAL_MINUTES=600` and confirming scheduled login checks no longer occur hourly/frequently.
- reasoning_checkpoint:
  hypothesis: "The scheduler ran too frequently because it encoded arbitrary minute intervals as cron minute-field steps; `*/600 * * * *` is normalized by node-cron to minute 0 of every hour."
  confirming_evidence:
    - "`server/services/system/scheduler.js` previously built `cronExpression = \`*/${checkInterval} * * * *\`` from the configured value."
    - "Installed node-cron conversion maps `*/600 * * * *` to minute field `[0]`, which fires hourly rather than every 600 elapsed minutes."
    - "The UI and settings handler allow/persist 600, so the user-facing configuration can reach the broken scheduler path."
  falsification_test: "A scheduler test with `LOGIN_CHECK_INTERVAL_MINUTES=600` would disprove the fix if the login check ran before 600 elapsed minutes or failed to run at exactly/after 600 elapsed minutes."
  fix_rationale: "A one-minute cron tick plus an elapsed-time gate represents arbitrary minute intervals in application logic instead of overloading cron's 0-59 minute field."
  blind_spots: "Self-verification uses mocked scheduler callbacks and system time; the real operator environment still needs confirmation after restarting the Node service."
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-18T00:00:00+08:00
  checked: `server/services/system/scheduler.js`
  found: Login checks read `LOGIN_CHECK_INTERVAL_MINUTES`, default to 30, and build `cronExpression = \`*/${checkInterval} * * * *\`` before passing it to `cron.schedule`.
  implication: Any interval greater than the cron minute field range is represented as a cron step instead of elapsed minutes, so 600 minutes cannot be expressed correctly by this path.
- timestamp: 2026-05-18T00:00:00+08:00
  checked: `server/services/system/handlers.js`
  found: The login-check settings endpoint writes `LOGIN_CHECK_INTERVAL_MINUTES` directly from the submitted `intervalMinutes` value and returns the same parsed value later.
  implication: A user can persist 600 minutes successfully; the failure happens when the scheduler translates that setting into a cron expression.
- timestamp: 2026-05-18T00:00:00+08:00
  checked: `server/services/system/__tests__/scheduler.test.js`
  found: Existing scheduler tests cover that login checks run without Feishu alerts, but do not assert the scheduled expression for large intervals.
  implication: A regression test can reproduce the bug at the scheduler boundary without running browser RPA.
- timestamp: 2026-05-18T00:00:00+08:00
  checked: Installed `node-cron` conversion for `*/600 * * * *`
  found: `node-cron.validate('*/600 * * * *')` returns true, then conversion maps the minute field to `[0]`; this is equivalent to the top of every hour, not every 600 minutes.
  implication: The scheduler cannot use cron minute steps as a generic minute interval mechanism.
- timestamp: 2026-05-18T11:11:17+08:00
  checked: Focused regression tests and lint
  found: `npm test -- server/services/system/__tests__/scheduler.test.js` passed 10 tests, including the 600 minute interval regression; `npm run lint -- --quiet` passed.
  implication: The scheduler fix is self-verified in automated tests.

## Eliminated

## Resolution

- root_cause: The login-check scheduler represented every configured interval as a cron minute-field step. For 600 minutes it created `*/600 * * * *`; node-cron accepts this but normalizes it to minute 0 of every hour, so checks run hourly instead of every 600 elapsed minutes.
- fix: Changed login checks to use a stable `* * * * *` cron tick with an elapsed-time gate, rereading login-check config on each tick, skipping while disabled, and avoiding overlapping checks. Added scheduler regression coverage for 600 minute intervals.
- verification: `npm test -- server/services/system/__tests__/scheduler.test.js`; `npm run lint -- --quiet`.
- files_changed:
  - server/services/system/scheduler.js
  - server/services/system/__tests__/scheduler.test.js
