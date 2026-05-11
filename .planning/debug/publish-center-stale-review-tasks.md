---
status: resolved
trigger: "在发布中心的选择任务里面会出现很多其他的任务特别是我重做的任务，那些重复的任务我都在审核中心删除了但是在发布中心选择任务的时候又出现了，解决这个问题，防止复发，让发布中心的任务始终只有审核中心存在的任务"
created: 2026-05-11
updated: 2026-05-11
---

# Debug Session: publish-center-stale-review-tasks

## Symptoms

- Expected behavior: 发布中心“选择任务”列表只显示审核中心当前仍存在的任务。
- Actual behavior: 审核中心已删除的重复/重做任务，仍会在发布中心选择任务时出现。
- Error messages: 未报告错误信息。
- Timeline: 2026-05-11 用户报告；重做任务和已在审核中心删除的任务最明显。
- Reproduction: 在审核中心删除重复任务后，打开发布中心选择任务弹窗/任务选择控件，观察旧任务是否仍出现。

## Current Focus

- hypothesis: 发布中心 `/api/publish/assets` 从本地视频文件扫描生成候选素材，但没有在后端过滤审核中心删除时写入的 `reviewCenterHiddenAt` / `reviewCenterHiddenReviewId` 标记。
- test: `npm test -- --runInBand server/services/publish/__tests__/assets.test.js`; `npm test -- --runInBand server/services/review/__tests__/handlersPersistence.test.js`; `npm test -- --runInBand server/services/publish/__tests__/handlers.test.js`; `npm run lint -- --quiet`
- expecting: 审核中心删除后的素材不会再进入发布资产列表，也无法被发布中心选择或创建发布任务。
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-11
  source: frontend/src/components/ReviewCenterWorkspace.vue
  observation: 审核中心列表通过 `/api/publish/assets?refresh=1` 获取素材后，在前端过滤 `metadata.reviewCenterHiddenAt`。
- timestamp: 2026-05-11
  source: server/services/review/handlers.js
  observation: 删除审核记录会清除 `metadata.aiReview`，写入 `reviewCenterHiddenAt` 和 `reviewCenterHiddenReviewId`，并重置发布资产缓存。
- timestamp: 2026-05-11
  source: server/services/publish/assets.js
  observation: 发布中心资产扫描合并 metadata 后返回所有存在的视频文件，修复前没有后端级别过滤 review-center hidden 标记。
- timestamp: 2026-05-11
  source: server/services/publish/handlers.js
  observation: 发布中心列表、描述生成和创建发布任务都依赖 `getCachedPublishAssets` / `collectPublishAssets`，因此在资产服务层过滤可以覆盖显示和创建任务路径。

## Eliminated

- hypothesis: 仅仅是发布中心前端缓存导致重复任务回弹。
  evidence: 审核删除会调用 `resetPublishAssetsCache`，且发布中心主动刷新仍会从后端扫描视频文件重建列表。
- hypothesis: 创建发布任务接口单独绕过了选择列表。
  evidence: `createJob` 使用 `collectPublishAssets()` 按 assetId 查找素材；资产服务层过滤后旧 assetId 找不到，会返回素材不存在。

## Resolution

- root_cause: 审核中心删除记录后，后端只在视频 metadata 上标记“审核中心隐藏”，审核中心前端知道过滤该标记；发布中心后端资产扫描不知道过滤该标记，所以已删除审核任务对应的视频会重新进入发布中心候选素材。
- fix: 在 `server/services/publish/assets.js` 增加 `isReviewCenterHidden` 统一判断，并在 `addAsset` 读取/合并 metadata 前过滤带 `reviewCenterHiddenAt` 或 `reviewCenterHiddenReviewId` 的素材。
- verification: `npm test -- --runInBand server/services/publish/__tests__/assets.test.js`; `npm test -- --runInBand server/services/review/__tests__/handlersPersistence.test.js`; `npm test -- --runInBand server/services/publish/__tests__/handlers.test.js`; `npm run lint -- --quiet`
- files_changed: server/services/publish/assets.js; server/services/publish/__tests__/assets.test.js; .planning/debug/publish-center-stale-review-tasks.md
