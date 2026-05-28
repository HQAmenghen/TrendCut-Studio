---
status: resolved
trigger: "内容管理页已打开并提示浏览器保持打开；手动关闭打开的浏览器后，再点击内容管理按钮打不开。"
created: "2026-05-22T00:00:00+08:00"
updated: "2026-05-22T00:00:00+08:00"
---

# Debug Session: content-manager-reopen-close

## Symptoms

- Expected behavior: 内容管理浏览器被用户手动关闭后，再次点击账号卡片里的“内容管理”按钮，应重新启动对应账号的独立浏览器窗口并打开内容管理页。
- Actual behavior: 第一次打开后前端提示“内容管理已打开，浏览器会保持打开”；关闭弹窗后浏览器保持打开。用户手动关闭该外部浏览器后，再点击按钮无法重新打开。
- Error messages: 用户反馈未提到具体错误文案；可见行为是按钮再次点击无效/打不开。
- Timeline: 发生在内容管理入口支持“关闭弹窗，浏览器保持打开”之后。
- Reproduction: 打开账号控制中心内容管理页，关闭面板弹窗，手动关闭外部 Chromium 窗口，再点击同一账号的内容管理按钮。

## Current Focus

- hypothesis: 服务端内容管理会话在外部浏览器手动关闭后没有及时清理 `activeContentManagers`/进程状态，后续点击被误判为 `already_open` 或轮询旧状态，导致不再启动新的浏览器。
- test: 检查微信 `openWechatContentManager` 与通用平台 `openPlatformContentManager` 的会话生命周期、进程退出/页面关闭后的状态清理，以及前端按钮对 `opened/already_open` 状态的处理。
- expecting: 浏览器窗口关闭后，下一次内容管理请求会清理陈旧会话并重新启动；已有活跃窗口时仍返回已打开，避免重复开窗。
- next_action: fixed and verified
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-22T00:00:00+08:00
  observation: 旧 debug `account-content-manager-no-response` 修过“打开后误判失败并关闭浏览器”；旧 debug `account-content-manager-login` 修过“打开前额外登录检测”。当前反馈发生在手动关闭已保持打开的外部浏览器之后，属于会话清理/重开路径。
- timestamp: 2026-05-22T00:00:00+08:00
  observation: 微信内容管理服务只用 `proc.exitCode === null && proc.signalCode === null` 判断已有会话是否仍打开，没有排除被杀掉的进程对象；通用平台内容管理也会直接复用 `contentManagerSessions` 中的旧会话响应。
- timestamp: 2026-05-22T00:00:00+08:00
  observation: Python opener 的等待循环只检查 `len(browser.pages)` / `len(context.pages)`，关闭页面后页面对象可能仍短暂保留，导致 Node 侧旧会话清理不够及时。

## Eliminated

- hypothesis: 前端按钮永久禁用
  reason: `handleOpenContentManager` 的 `finally` 会清理 `contentManagerActionLabels`，按钮应在请求结束后解锁；故障更符合后端复用旧 opened/already_open 会话。

## Resolution

- root_cause: 内容管理 opener 会把外部浏览器保持打开，后端用长生命周期会话避免重复开窗；但窗口被用户手动关闭后，Python 页面关闭检测和 Node 旧会话活性判断都不够严格，可能继续复用陈旧会话并返回 `already_open`，于是下一次点击不会重新启动浏览器。
- fix: Python opener 改为只把 `page.is_closed() === false` 的页面视为活跃页面，窗口关闭后更快退出；微信和通用平台 Node 服务在复用会话前排除 killed/已退出进程并清理陈旧 session；通用平台请求结算时同步清理 timeout，避免测试和运行时残留计时器。
- verification: `npx jest server/services/publish/__tests__/wechatRpa.login.test.js server/services/publish/__tests__/platformRpa.test.js --runInBand`; `python -m unittest python.tests.test_wechat_open_content_manager python.tests.test_social_auto_upload_adapter`; `python -m py_compile python\\publish\\wechat_open_content_manager.py python\\publish\\social_auto_upload_adapter.py`; `node -c server\\services\\publish\\wechatRpa.login.js`; `node -c server\\services\\publish\\platformRpa.js`.
- files_changed: `server/services/publish/wechatRpa.login.js`, `server/services/publish/platformRpa.js`, `python/publish/wechat_open_content_manager.py`, `python/publish/social_auto_upload_adapter.py`, `server/services/publish/__tests__/wechatRpa.login.test.js`, `server/services/publish/__tests__/platformRpa.test.js`, `python/tests/test_wechat_open_content_manager.py`, `python/tests/test_social_auto_upload_adapter.py`, `.planning/debug/content-manager-reopen-close.md`.
