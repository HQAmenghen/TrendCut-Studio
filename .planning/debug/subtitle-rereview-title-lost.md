---
status: resolved
trigger: "User reported that after re-reviewing subtitles, the title/name disappeared, forcing deletion and recreation."
created: "2026-05-19"
updated: "2026-05-19"
---

# Debug Session: subtitle-rereview-title-lost

## Symptoms

- Expected behavior: Re-reviewing subtitles or rerendering subtitle fixes should preserve the existing vertical title in the video, metadata, and task files.
- Actual behavior: User reports the Review Center title/name was removed after subtitle re-review, forcing them to delete and redo the task. User clarified this is not the title rendered inside the video frame.
- Error messages: None reported.
- Timeline: Reported after manual subtitle timing repair and refreshed xAI vertical queue artifacts on 2026-05-19.
- Reproduction: Inspect review/rerender/regeneration code paths that update `content.json`, public metadata, and subtitle/card generation.

## Current Focus

- hypothesis: Review Center displays publish asset labels derived from public media metadata. Subtitle re-review/regeneration can write or read partial metadata where `title`/`suggestedTitle` are blank/default even though the runtime `content.json` still has the real title.
- test: Inspect `/api/publish/assets?refresh=1`, metadata files, `server/services/review/handlers.js`, `server/services/review/regenerate.js`, `server/services/publish/assets.js`, `server/services/vertical/queue.js`, and `frontend/src/components/ReviewCenterWorkspace.vue`; add regression coverage.
- expecting: Review Center display title prefers real `metadata.title`; re-review/regeneration recovers runtime `content.json` titles before enqueueing/rerendering; blank refreshed metadata cannot mask a known title.
- next_action: fixed and verified
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-19T10:12:00+08:00
  observation: `public/xai_vertical_queue/1779152460046_qv9xk69/vertical_output.mp4.meta.json` had real `title` (`黄仁勋警告...`) but `suggestedTitle` and `suggestedShortTitle` were `vertical output`.
  implication: The title was not lost from the video/frame metadata title field; the Review Center display path was being misled by publish/review suggestion fields.
- timestamp: 2026-05-19T10:14:00+08:00
  observation: `ReviewCenterWorkspace.vue` maps `displayName` from `asset.compactLabel`, and `server/services/publish/assets.js` built `compactLabel` from `mergedMetadata.suggestedTitle || suggestedShortTitle || label`.
  implication: A stale/default `suggestedTitle` can override a valid saved `title` in Review Center cards.
- timestamp: 2026-05-19T10:17:00+08:00
  observation: `reviewVideo` persisted metadata built from default filename fields merged with saved metadata; when saved metadata had title but default suggested title, the default suggestion survived.
  implication: Re-review could keep the real title while still poisoning the Review Center display field.
- timestamp: 2026-05-19T10:19:00+08:00
  observation: Existing polluted metadata was repaired for `1779152460046_qv9xk69` and `1779149460052_booeazv`; `/api/publish/assets?refresh=1` shows visible Review Center entries using real titles such as `十年1000个 现在20个就能买房？`.
  implication: Current visible artifacts no longer display `vertical output` as the title.
- timestamp: 2026-05-19T10:31:00+08:00
  observation: `data/uploads/xai_vertical_queue/1779147540079_uwrlwcp/failure.json` persisted `"title": ""`, while the same job's `content.json` and public `vertical_output.mp4.meta.json` retained `战略比特币储备公告进入执行阶段`.
  implication: Subtitle repair/rerender task artifacts can lose the UI title even when recoverable runtime metadata still exists.
- timestamp: 2026-05-19T10:31:00+08:00
  observation: `/api/review/regenerate` read raw media metadata before enqueueing, while `reviewVideo` used `buildReviewMetadata` enrichment that can recover `content.json` titles.
  implication: A blank public `.meta.json` title could enqueue a regeneration job with `title: ""`, causing later queue metadata/failure artifacts to stay untitled.
- timestamp: 2026-05-19T10:31:00+08:00
  observation: `server/services/publish/assets.js` merged saved media metadata over runtime metadata and did not repair `title` when saved metadata carried blank title fields.
  implication: Refreshed public metadata with blank title could mask `data/uploads/xai_vertical_queue/<job>/content.json` and make Review Center show a fallback label.

## Eliminated

- hypothesis: The rendered video title inside the frame was removed.
  reason: User clarified the missing title was in Review Center display, and metadata retained the video `title`.

## Resolution

- root_cause: Review Center title display depended on publish asset labels derived from public media metadata. Re-review/default metadata could demote the display title to filename-derived suggestions, and subtitle regeneration/rerender paths could enqueue or persist blank/default titles when public `.meta.json` was partial, even though runtime `content.json` still held the real title.
- fix: In `server/services/review/handlers.js`, normalize review metadata and use enriched metadata before regeneration enqueue. In `server/services/review/regenerate.js`, only enqueue a non-empty preserved title. In `server/services/vertical/queue.js`, recover existing public/content titles before rerendering and when writing failure artifacts. In `server/services/publish/assets.js`, treat blank/default saved titles as non-authoritative, recover runtime titles, and build card labels from real `metadata.title` before suggestion fields. In `frontend/src/components/ReviewCenterWorkspace.vue`, prefer `asset.metadata.title` directly for Review Center `displayName`.
- files_changed:
  - `server/services/review/handlers.js`
  - `server/services/review/regenerate.js`
  - `server/services/publish/assets.js`
  - `server/services/vertical/queue.js`
  - `frontend/src/components/ReviewCenterWorkspace.vue`
  - `server/services/review/__tests__/handlersPersistence.test.js`
  - `server/services/review/__tests__/regenerate.test.js`
  - `server/services/publish/__tests__/assets.test.js`
  - `server/services/vertical/__tests__/queueAsrFileUrl.test.js`
  - `.planning/debug/subtitle-rereview-title-lost.md`
- verification:
  - `npm test -- --runTestsByPath server/services/review/__tests__/regenerate.test.js server/services/review/__tests__/handlersPersistence.test.js server/services/publish/__tests__/assets.test.js server/services/vertical/__tests__/queueAsrFileUrl.test.js`
  - `npm run lint -- --quiet`

