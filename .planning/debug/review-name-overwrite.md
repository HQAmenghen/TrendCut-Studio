---
status: resolved
trigger: "审核模块完成审核后，会把原来的名字覆盖成类似 standalone output vertical 的通用名字"
created: 2026-05-08
updated: 2026-05-08
---

# Debug Session: Review Name Overwrite

## Symptoms
- Expected behavior: 审核完成后，视频卡片保留原始素材/任务名称。
- Actual behavior: 审核完成后，原来的名字被覆盖成类似 `standalone output vertical` 的通用名称。
- Evidence: 用户截图中多个审核结果卡片标题重复显示 `standalone output vertical`。
- Reproduction: 触发审核模块完成审核并刷新/查看审核中心列表。

## Current Focus
- hypothesis: 审核结果持久化或前端合并结果时用派生文件名覆盖了原始任务名称。
- test: 追踪 review store、handlers、frontend review workspace/composable 对 title/name/originalName 的读写。
- expecting: 找到完成审核后写入 SQLite 或响应对象时重新计算并覆盖标题的代码路径。
- next_action: verify targeted regression and lint
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence
- 2026-05-08: `reviewVideo` / `skipReview` 在没有 `.meta.json` 时先调用 `buildDefaultMetadata(videoPath)`，将 `standalone_output_vertical.mp4` 推导为 `standalone output vertical`。
- 2026-05-08: `enrichMetadataFromRuntimeFiles` 用 `hasTitle` 判断是否从运行时 `content.json` 补标题；默认文件名标题已存在时会跳过真实标题。
- 2026-05-08: 审核状态写回同一个 `*.meta.json` 后，发布素材列表优先读取 `savedMetadata.suggestedTitle`，因此卡片显示被覆盖后的通用名。

## Eliminated

## Resolution
- root_cause: 审核模块把文件名兜底标题当成已有标题，导致运行时 job 的真实标题未能从 `content.json` 回填，并被写入媒体 metadata。
- fix: 新增 `buildReviewMetadata`，先用真实保存/运行时元数据做 enrichment，再只在缺省字段上合并文件名兜底标题。
- verification: `npm test -- --runTestsByPath server/services/review/__tests__/handlersPersistence.test.js`; `npm run lint`
- files_changed: `server/services/review/handlers.js`, `server/services/review/__tests__/handlersPersistence.test.js`, `.planning/debug/review-name-overwrite.md`
