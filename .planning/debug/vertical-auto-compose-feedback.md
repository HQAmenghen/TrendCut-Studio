---
status: resolved
trigger: "合成链路应该默认竖屏也加入到最后一个步骤的，不用再点击竖屏合成了，而且我点击之后没有反馈没有进度，成品库里面也没有"
created: 2026-05-26
updated: 2026-05-26
---

## Symptoms

- Expected behavior: material-driven production should automatically run vertical composition as part of the final step.
- Actual behavior: the UI exposes a manual vertical composition button; clicking it gives little visible feedback, and the publish asset library does not visibly refresh with the generated result.
- Reproduction: complete a material-driven run with `finalVideoUrl`, then click the output area vertical composition action.

## Current Focus

- hypothesis: vertical composition state is isolated in `useStandalone()` and not surfaced in the material-driven dashboard; completion does not refresh publish assets.
- test: inspect frontend bridge in `App.vue`, standalone submit behavior, and publish asset refresh methods.
- expecting: add automatic one-shot trigger after final material output, show status in production/output UI, refresh library on completion, and remove the manual primary action.
- next_action: gather code evidence and implement the focused fix.

## Evidence

- timestamp: 2026-05-26T00:00:00+08:00
  observation: `frontend/src/App.vue` has `handleMakeVertical()` wired only to `@make-vertical`; no watcher or completion hook automatically invokes it when `materialDriven.finalVideoUrl` is set.
  significance: vertical composition remains a manual action after material-driven completion.
- timestamp: 2026-05-26T00:00:00+08:00
  observation: `handleMakeVertical()` awaits `standalone.submit()` but does not refresh `publishCenter` assets/jobs afterward.
  significance: a successful vertical render can finish without the dashboard asset library reflecting the new output.
- timestamp: 2026-05-26T00:00:00+08:00
  observation: `frontend/src/composables/useStandalone.js` only calls `loadQueue()` after success; it has no publish asset refresh dependency or callback.
  significance: standalone state and publish-center state are isolated.
- timestamp: 2026-05-26T00:00:00+08:00
  observation: `server/services/publish/assets.js` already includes `standalone_runtime` outputs from `data/uploads/runtime_jobs/*/standalone_output_vertical.mp4`, and `/api/publish/assets?refresh=1` forces a rescan.
  significance: the asset collection path exists; the missing visible refresh is frontend orchestration/caching, not a missing server collector.
- timestamp: 2026-05-26T00:00:00+08:00
  observation: `server/services/vertical/standalone.js` returns `/standalone_output_vertical.mp4?t=...` after copying the latest output to `public/`, while metadata points back to the runtime job dir.
  significance: the public alias is mutable; the publish library should be refreshed to pick the stable runtime asset row.
- timestamp: 2026-05-26T00:00:00+08:00
  observation: runtime output metadata now records `sourceTaskDir`, and publish assets pass it through on `standalone_runtime` metadata.
  significance: the frontend can prefer the vertical asset generated from the current material-driven task instead of relying on the mutable public alias.

## Eliminated

- Server-side publish asset discovery is not the primary blocker: completed standalone runtime jobs are already indexed as `standalone_runtime`.
- Manual vertical generation does have an SSE progress mechanism through `useStandalone.createProgressStream()`; the dashboard feedback gap is mostly because that state is not promoted into the material-driven completion flow as an automatic post-step.

## Resolution

- root_cause: Material-driven completion sets `finalVideoUrl`, but the cockpit only exposes vertical composition as a manual `make-vertical` event; after `standalone.submit()` succeeds, publish assets are not force-refreshed, so the generated stable runtime output is not surfaced in the dashboard library.
- fix: Added a guarded auto-trigger when a material-driven `finalVideoUrl` appears, surfaced standalone loading/progress/status as the final vertical-compose step, removed the manual vertical button, refreshed publish assets after vertical completion, and recorded `sourceTaskDir` in runtime output metadata.
- verification: `npm run build:front`; `npx jest server/services/publish/__tests__/assets.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js --runInBand`; `npm run lint`; browser smoke check on `http://localhost:3001/`.
- files_changed: `frontend/src/App.vue`, `frontend/src/components/AutomationDashboard.vue`, `frontend/src/composables/useStandalone.js`, `server/services/vertical/standalone.js`, `server/services/publish/assets.js`, `.planning/debug/vertical-auto-compose-feedback.md`
