---
status: resolved
trigger: "审核中心存在很久的任务不能删除，而且新的任务也不能持久化显示，只会在那一次会话中显示"
created: "2026-05-08"
updated: "2026-05-08"
---

# Debug Session: review-center-task-persist

## Symptoms

- Expected behavior: 审核中心的历史任务可以删除；新创建或完成的审核任务刷新页面/重启服务后仍能从持久化存储恢复显示。
- Actual behavior: 一些很久的审核中心任务不能删除；新任务只在当前会话中显示，不能持久化出现在后续会话。
- Error messages: 用户未提供明确报错。
- Timeline: 当前线上/本地工作区已出现，具体开始时间未知。
- Reproduction: 打开审核中心，尝试删除旧任务；创建新审核任务后刷新页面或重新打开会话观察列表。

## Current Focus

- hypothesis: 审核中心显示源是发布素材视频元数据，而删除和部分失败状态只操作 SQLite 审核记录；同时“删除”需要移出审核中心列表，而不是只清掉审核状态
- test: inspect review center frontend state, backend review routes/handlers, and SQLite review store deletion/list persistence paths
- expecting: delete removes the card from the review center via a durable hidden marker; review start/failure/success persists to metadata and resets publish asset cache
- next_action: complete verification
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- 2026-05-08: `frontend/src/components/ReviewCenterWorkspace.vue` loads the visible review cards from `/api/publish/assets` and maps `asset.metadata.aiReview` into `video.reviewStatus`.
- 2026-05-08: `server/services/review/handlers.js` delete endpoint only called `deleteReviewRecord(reviewId)`, so records whose status lived in `*.mp4.meta.json` stayed visible after deletion.
- 2026-05-08: Auto review metadata uses IDs such as `auto_1778197633196` and can exist without a matching SQLite row in `data/ai_review.db`.
- 2026-05-08: Manual review failures updated SQLite to `failed` but did not persist `metadata.aiReview` unless `auto_skip_on_error` was enabled, so failed tasks could disappear from the review center after refresh.
- 2026-05-08: Recent completed vertical synthesis videos are written under `data/uploads/runtime_jobs/standalone_*/standalone_output_vertical.mp4`; publish asset collection only exposed the latest copied `public/standalone_output_vertical.mp4`, so older completed vertical outputs were missing.
- 2026-05-08: `projects/material_*/output_final.mp4` is a horizontal/intermediate material-driven product and should not be listed in the review center.

## Eliminated

## Resolution

- root_cause: 审核中心的 visible source of truth 是视频元数据，删除和失败持久化却只覆盖 SQLite 记录；清掉 `metadata.aiReview` 会让卡片重新变成“待审核”，没有真正从审核中心消失。
- fix: 审核开始、成功、失败、跳过都写入视频元数据并清理发布素材缓存；删除审核记录时同时删除 SQLite 行，并按传入/记录里的 videoPath 写入 `reviewCenterHiddenAt` / `reviewCenterHiddenReviewId` 隐藏标记；审核中心刷新强制绕过发布素材缓存并过滤隐藏任务。重新审核会自动清除隐藏标记。发布素材枚举现在扫描 `data/uploads/runtime_jobs/standalone_*/standalone_output_vertical.mp4`，并通过受限 `/runtime_jobs/:jobId/standalone_output_vertical.mp4` 路由提供已完成竖屏合成视频；不再枚举 `projects/material_*/output_final.mp4` 横屏半成品。
- verification: `npx jest server/services/review/__tests__/handlersPersistence.test.js --runInBand`; `npx jest server/services/publish/__tests__/assets.test.js --runInBand`; `npm run lint`; `npx jest server/services/review/__tests__/handlersPersistence.test.js server/services/publish/__tests__/scheduling.test.js --runInBand`; `npm run build:front`; `npm test -- --runInBand`; local Node collect confirmed recent `standalone_1778214630863_4ff35aa7`, `standalone_1778209829005_273c1569`, and `standalone_1778207415426_1a294712` vertical assets are returned, while material horizontal output count is 0.
- files_changed: `server/services/review/handlers.js`, `server/services/review/store.js`, `server/services/review/__tests__/handlersPersistence.test.js`, `frontend/src/components/ReviewCenterWorkspace.vue`, `server.js`, `server/services/publish/assets.js`, `server/services/publish/__tests__/assets.test.js`
