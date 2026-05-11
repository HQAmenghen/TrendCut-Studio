---
status: resolved
trigger: "用户反馈：设置多个自动发布任务同一时间发送时，会出现多个任务使用同一个视频文件。"
created: "2026-05-08"
updated: "2026-05-08"
---

# Debug Session: Auto Publish Shared Video

## Symptoms

- expected_behavior: 多个自动发布任务即使在同一时间触发，也应各自使用创建任务时绑定的视频文件。
- actual_behavior: 多个任务同时发送时，实际上传/发布的视频文件可能变成同一个。
- error_messages: 用户未报告明显错误日志；表现为发布内容不匹配。
- timeline: 发生在自动发布中心支持多任务同时间发送的场景。
- reproduction: 在自动发布相关功能中配置多个任务使用同一发布时间，等待调度器同时执行。

## Current Focus

- hypothesis: 自动发布调度创建多个任务时没有使用注入的强唯一 ID 生成器，回退到 `job_${Date.now()}`，同一毫秒内创建的任务会共享 job id，进而覆盖 SQLite 行和 RPA payload 文件；旧独立竖屏任务还可能绑定 `public/standalone_output_vertical.mp4` 这种会被后续生成覆盖的公共别名。
- test: 阅读发布 store、scheduler、素材收集和 WeChat RPA 入参；补充回归断言 store 暴露注入的 makeJobId，scheduler 使用该 ID 生成器创建同一轮自动发布任务，RPA 启动时使用 runtime 私有视频路径，同账号运行锁在异步 payload 写入前生效。
- expecting: 多个同一时间触发的自动发布任务拥有不同 job id，并保留各自绑定的稳定 asset/videoPath；同账号同一时间启动时后续任务被挡住并保留重试机会。
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-08T14:55:21+08:00
  observation: `server/core/runtime.js` 的 `makeJobId()` 使用 `Date.now()` 加随机字节，具备同毫秒抗碰撞能力。
  source: `server/core/runtime.js:50`
- timestamp: 2026-05-08T14:55:21+08:00
  observation: `server.js` 将 `makeJobId` 注入 `createPublishStore`，但 `server/services/publish/store.js` 原本没有把该函数暴露到返回对象。
  source: `server.js:557`, `server/services/publish/store.js`
- timestamp: 2026-05-08T14:55:21+08:00
  observation: 自动发布调度创建 publish job 时调用 `publishStore.makeJobId ? publishStore.makeJobId() : \`job_${Date.now()}\``；由于真实 store 未暴露 `makeJobId`，生产路径会走只含毫秒时间戳的 fallback。
  source: `server/services/system/scheduler.js:1039`
- timestamp: 2026-05-08T14:55:21+08:00
  observation: publish jobs 持久化表以 `id` 为主键，`writePublishJobs` 使用 `INSERT OR REPLACE`；同 id 任务会互相替换，导致只保留某一个任务的 asset/videoPath。
  source: `server/services/publish/publishStore.migrations.js:26`, `server/services/publish/store.js:187`
- timestamp: 2026-05-08T14:55:21+08:00
  observation: WeChat RPA payload 文件名由 `jobId` 构成，`startWechatRpa` 再从当前 job 的 `asset.path` 写入 `videoPath`；同 id 会让多个调度任务指向同一 payload/job 行。
  source: `server/services/publish/wechatRpa.process.js:124`
- timestamp: 2026-05-08T14:55:21+08:00
  observation: Focused verification passed: `npx jest server/services/publish/__tests__/scheduling.test.js server/services/system/__tests__/scheduler.test.js --runInBand`。
  source: terminal
- timestamp: 2026-05-08T14:58:32+08:00
  observation: Resumed investigation re-ran focused verification; `npx jest server/services/publish/__tests__/scheduling.test.js server/services/system/__tests__/scheduler.test.js --runInBand` passed 2 suites / 15 tests, and `git diff --check` reported no whitespace errors beyond CRLF conversion warnings.
  source: terminal
- timestamp: 2026-05-08T15:20:00+08:00
  observation: 历史 `python/publish/wechat_channels_tasks/*.json` 中多条任务的 `videoPath` 指向同一个 `public\standalone_output_vertical.mp4`，这是独立竖屏公共别名，会被后续生成覆盖。
  source: `python/publish/wechat_channels_tasks`
- timestamp: 2026-05-08T15:20:00+08:00
  observation: `startWechatRpa` 原先在异步写 payload 和启动 Python 后才设置 `publishRuntimeProcesses`，同账号任务并发启动时存在同时通过账号占用检查的窗口。
  source: `server/services/publish/wechatRpa.process.js`

## Eliminated

- hypothesis: RPA Python 脚本在上传阶段重新扫描素材目录导致共享视频。
  evidence: Node 在启动 Python 前写入 payload，并且 `python/publish/wechat_channels_rpa.py` 从 payload 的 `videoPath` 精确读取上传文件。
- hypothesis: 手动创建发布任务未绑定 asset path。
  evidence: `server/services/publish/handlers.js` 创建 job 时直接保存选中的 `asset`，RPA 执行时读取 `job.asset.path`。

## Resolution

- root_cause: 真实 publish store 未暴露注入的强唯一 `makeJobId`，自动发布调度因此回退到 `job_${Date.now()}`。多个任务在同一毫秒创建时可能获得相同 id，SQLite `INSERT OR REPLACE` 和按 job id 命名的 RPA payload 会把任务折叠到同一个视频资产。另一个风险是独立竖屏任务可能绑定会被覆盖的 `public/standalone_output_vertical.mp4`，同账号 RPA 锁占用过晚又放大了同一时间触发时的视频/会话串用风险。
- fix: 在 `server/services/publish/store.js` 增加 store 级 `makeJobId` 导出，优先使用注入的 `makeJobId`，仅在缺失/空值时使用带随机后缀的 fallback；RPA 启动时存在 `asset.metadata.taskDir` 就优先使用该 runtime 目录下的 `standalone_output_vertical.mp4`；同账号 runtime 锁提前到异步 payload 写入前；发布素材列表不再优先暴露可覆盖的公共独立竖屏别名。
- verification: `npx jest server/services/publish/__tests__/scheduling.test.js server/services/system/__tests__/scheduler.test.js --runInBand` 通过；`npm test -- --runTestsByPath server/services/publish/__tests__/assets.test.js server/services/publish/__tests__/wechatRpa.process.test.js` 通过；`npm test -- --runTestsByPath server/services/publish/__tests__/scheduling.test.js server/services/system/__tests__/scheduler.test.js` 通过；`npx eslint server/services/publish --ext .js` 通过。
- files_changed: `server/services/publish/store.js`, `server/services/publish/wechatRpa.process.js`, `server/services/publish/assets.js`, `server/services/publish/__tests__/scheduling.test.js`, `server/services/publish/__tests__/wechatRpa.process.test.js`, `server/services/publish/__tests__/assets.test.js`, `server/services/system/__tests__/scheduler.test.js`, `.planning/debug/auto-publish-shared-video.md`
