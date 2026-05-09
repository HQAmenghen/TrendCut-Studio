---
status: resolved
trigger: "在自动发布视频号的rpa任务中，在地区下拉框选择不展示地区，你可以开一个新的浏览器任务，我帮你登录，调试和找到定位"
created: "2026-05-08"
updated: "2026-05-09"
---

# Debug Session: wechat-rpa-hide-region

## Symptoms

- Expected behavior: 自动发布视频号 RPA 在发布页的地区下拉框中选择“不展示地区”。
- Actual behavior: 当前 RPA 没有稳定完成该选择，需要在真实登录页面调试定位。
- Error messages: 未提供明确报错。
- Timeline: 2026-05-08 用户提出需要新增/修正该 RPA 行为。
- Reproduction: 启动微信视频号自动发布 RPA，登录后进入发布编辑页，在地区下拉框处观察并定位“不展示地区”选项。

## Current Focus

- hypothesis: 发布页地区选择控件需要在填写文案后、发布前显式选择隐藏位置；真实控件是标签为 `位置` 的表单项。
- test: 使用已登录视频号助手发布页运行 RPA，确认地区/位置下拉框能打开并点击隐藏位置选项。
- expecting: 日志出现已选择地区隐藏选项，发布页位置字段最终不展示城市。
- next_action: complete
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- 2026-05-08: `python/publish/wechat_channels_rpa.py` had upload, description, short-title, original declaration, and publish steps, but no region/location selection step.
- 2026-05-08: Codex in-app browser could not open `https://channels.weixin.qq.com/platform/post/create` because the browser security policy blocks that domain, so live locator verification was not possible from this session.
- 2026-05-08: Added a best-effort `select_no_region(page)` step after short-title filling and before original declaration.
- 2026-05-08: `python -m py_compile python\publish\wechat_channels_rpa.py` passed.
- 2026-05-09: Ran headed Playwright RPA against a temporary profile with user-assisted QR login. First live pass reached the `位置` form item but missed the hidden-location option.
- 2026-05-09: User screenshot showed the field is a `.form-item` labeled `位置` with clickable `.form-item-body`; updated locator to click that field directly.
- 2026-05-09: Third live pass successfully clicked the hidden-location option using the live option text equivalent to `不显示位置`.

- timestamp: 2026-05-08
  observation: `python/publish/wechat_channels_rpa.py` already contains a focused uncommitted region-selection implementation: `NO_REGION_OPTION_TEXT = "不展示地区"`, helpers for visible-text detection, native/select/custom dropdown opening, option clicking, and a `select_no_region(page)` call before original declaration and publish.
  supports: Root cause hypothesis that the shipped RPA path previously did not select the region control; the current fix is localized to the publish fill flow.
- timestamp: 2026-05-08
  observation: Parsed `python/publish/wechat_channels_rpa.py` with Python `ast.parse`; result was `syntax ok`.
  supports: The focused RPA change is syntactically valid without importing Playwright or touching browser/runtime artifacts.
- timestamp: 2026-05-08
  observation: `git diff --check -- python/publish/wechat_channels_rpa.py .planning/debug/wechat-rpa-hide-region.md` exited successfully; only Git reported the existing LF-to-CRLF warning for the Python file.
  supports: No whitespace errors were introduced by the focused RPA/debug-state changes.

## Eliminated

## Resolution

- root_cause: The RPA publish flow did not include any handling for the video publish page's region display dropdown.
- fix: Add a best-effort region selector that handles native `<select>`, common Ant/WeUI/custom dropdown markup, a `位置` label + `.form-item-body` locator, and hidden-location text variants, then calls it before original declaration/publish.
- verification: Python syntax compilation/static parse passed and `git diff --check` passed. Live headed RPA in draft mode successfully selected the hidden-location option after user-assisted QR login.
- files_changed: `python/publish/wechat_channels_rpa.py`, `.planning/debug/wechat-rpa-hide-region.md`
