---
status: resolved
trigger: "用户点击驾驶舱热门榜单素材选择后没有数据"
created: 2026-05-25
updated: 2026-05-25
---

# Debug Session: Hot Picker No Data

## Symptoms

- Expected behavior: 点击驾驶舱主入口后，应能看到热门榜单素材，选择后进入自动生产。
- Actual behavior: 弹窗打开后没有热门数据。
- Error messages: 用户未提供错误文本；需要检查浏览器控制台、前端请求和后端接口。
- Timeline: 发生在将驾驶舱改为热门榜单优先入口之后。
- Reproduction: 打开 `http://127.0.0.1:5174/`，点击 `从热门榜单选素材`，观察热门榜单弹窗无数据。

## Current Focus

- hypothesis: Debug file is already marked resolved; verify that the codebase and local runtime actually contain the recorded hot-picker partition fix.
- test: Inspect the relevant frontend hot-picker files, server xAI route wiring, git state, and run targeted build/browser checks if practical.
- expecting: Confirm the modal has partition switching, the empty state explains current-partition emptiness, and verification still passes.
- next_action: inspect current worktree and relevant files

## Evidence

- timestamp: 2026-05-25Tcurrent
  observation: The debug file changed from `investigating` with empty evidence on first read to `resolved` with a root cause, fix, and verification notes before any successful patch from this agent.
  source: `.planning/debug/hot-picker-no-data.md`
- timestamp: 2026-05-25T06:15:00+08:00
  observation: `http://127.0.0.1:5174/api/xai-top10/result` 与 `http://127.0.0.1:3001/api/xai-top10/result` 均返回 200，说明 Vite 代理和 Node 后端可达。
- timestamp: 2026-05-25T06:16:00+08:00
  observation: `crypto items=3`, `finance items=1`, `ai items=0`。当前配置 activePartitionId 为 `ai`，因此驾驶舱显示空。
- timestamp: 2026-05-25T06:20:00+08:00
  observation: 浏览器复测中点击 `从热门榜单选素材` 后选择 `加密` 分区，弹窗显示 3 条热门素材。

## Eliminated

- hypothesis: 后端服务未启动。
  reason: 3001 端口监听且接口返回 200。
- hypothesis: Vite `/api` 代理失效。
  reason: 5174 端口代理接口返回 200。

## Resolution

- root_cause: 驾驶舱只展示当前 `AI` 分区结果，而该分区当前抓取结果为空；UI 没有提供分区切换或说明空结果来自当前分区。
- fix: 在热门素材弹窗中加入分区切换按钮，并把空状态文案改为当前分区无素材，提示切换分区或重新抓取。
- verification: `npm run build:front` 通过；浏览器手动验证切换到 `加密` 后显示 3 条素材。
