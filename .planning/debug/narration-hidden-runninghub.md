---
status: resolved
trigger: "Material-driven page sometimes hides generated digital-human narration; operator selected RunningHub workflow mode but UI still says probing/configuring ComfyUI address."
created: 2026-05-11
updated: 2026-05-11
---

# Debug Session: narration-hidden-runninghub

## Symptoms

- Expected behavior: generated digital-human narration/script content remains visible once available, and render-provider UI labels/messages match RunningHub when RunningHub mode is selected.
- Actual behavior: the generated narration can intermittently become invisible in the page, and the node config/test area still uses ComfyUI wording such as "ComfyUI 渲染节点配置" and "探测地址".
- Error messages: none provided; visual/UI mismatch shown in screenshot.
- Timeline: intermittent, observed during material-driven workflow while step 6 is active.
- Reproduction: run the material-driven page with RunningHub workflow mode enabled, generate the digital-human narration, then inspect the chain status and render node configuration area.

## Current Focus

- hypothesis: Frontend state and presentation for material-driven workflow still assumes ComfyUI in several labels/styles, and generated narration visibility depends on fragile status/card styling rather than content-aware contrast.
- test: Added regression coverage for provider-specific labels, selected-provider probing, visible narration text, and backend narration summary emission.
- expecting: Components derive labels from renderProvider, backend reliably emits narration text from `narration.json`, and generated script/status cards preserve readable foreground/background contrast.
- next_action: resolved

## Evidence

- timestamp: 2026-05-11T14:40:00+08:00
  observation: `MaterialDrivenNodeConfigPanel.vue` hard-coded "ComfyUI 渲染节点配置", ComfyUI placeholder/hint copy, and "探测地址" even when `gen.renderProvider` was `runninghub`.
  implication: Step 6 UI could show ComfyUI wording while the backend render provider was RunningHub.
- timestamp: 2026-05-11T14:42:00+08:00
  observation: `useMaterialDriven.testComfyConnection()` posted only `{ serverUrl }` to `/api/material-driven/test-comfy`; the server route defaults missing `renderProvider` to `comfyui`.
  implication: Clicking the probe/test button in RunningHub mode actually exercised the ComfyUI branch and returned ComfyUI-oriented messages.
- timestamp: 2026-05-11T14:44:00+08:00
  observation: Restored task payloads store narration text as `narration.full_text`, while the workspace preview only checked `narrationSummary.fullText` unless `narrationFullText` had already been set; the plan preview panel required `narrationSummary`.
  implication: On restored/intermittent state, generated narration could exist on disk/task state but the preview panel would not render it.
- timestamp: 2026-05-11T14:46:00+08:00
  observation: `.mini-status-card strong` used gradient text with `-webkit-text-fill-color: transparent` on muted gray cards.
  implication: Card values could become visually faint/transparent depending on rendering and background, matching the screenshot's low-contrast status cards.
- timestamp: 2026-05-11T15:05:00+08:00
  observation: The server parsed the narration summary from stdout chunks; if the "解说词摘要" line and numeric detail lines were split across chunks, the frontend might not receive the full-text summary event until a later refresh.
  implication: Generated narration could exist in `narration.json` but remain absent from the live preview.

## Eliminated

- hypothesis: Backend RunningHub render dispatch is missing.
  reason: `server/routes/materialDriven.js` already branches `/api/material-driven/test-comfy` by `resolveAvatarRenderProvider(cfg)`, and server avatar generation uses RunningHub-specific logs/dispatch when provider is present.

## Resolution

- root_cause: The frontend probe path and UI copy were still ComfyUI-centric: the test request omitted `renderProvider`, labels/hints were hard-coded to ComfyUI/"探测地址", and restored narration text in `full_text` could be hidden because the preview panel required a summary object.
- fix: Send the selected `renderProvider` in the probe request, derive node/setup labels from `gen.renderProvider`, emit narration summaries directly from `narration.json`, render narration when text exists even without a summary object, accept both `fullText` and `full_text`, and replace fragile transparent gradient metric text with solid readable text.
- verification: `npx jest frontend/src/__tests__/materialDrivenRunningHubConfig.test.js server/services/materialDriven/__tests__/events.test.js --runInBand` passed; `npm run build:front` passed.
- files_changed: `frontend/src/composables/useMaterialDriven.js`; `frontend/src/components/MaterialDrivenWorkspace.vue`; `frontend/src/components/materialDriven/MaterialDrivenNodeConfigPanel.vue`; `frontend/src/components/materialDriven/MaterialDrivenPlanPreview.vue`; `frontend/src/components/materialDriven/MaterialDrivenSetupPanel.vue`; `frontend/src/__tests__/materialDrivenRunningHubConfig.test.js`; `server/services/materialDriven/events.js`; `server/services/materialDriven/pipelineProcess.js`; `server/services/materialDriven/__tests__/events.test.js`; `.planning/debug/narration-hidden-runninghub.md`
