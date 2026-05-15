---
status: in-progress
quick_id: 260515-hmx
created: 2026-05-15
---

代码级融合 social-auto-upload 抖音/小红书 uploader，并支持草稿模式。

目标：
- 不复制第三方仓库大段代码，优先通过 import + subclass/adapter 复用其 uploader。
- 新增 `python/publish/social_auto_upload_adapter.py` 作为本项目稳定边界。
- adapter 支持 `draft`：上传、填写、保持浏览器打开，返回 `ready_for_manual_publish`。
- adapter 支持 `publish`：调用第三方原有发布流程。
- Node 发布中心优先调用 adapter，保留 CLI 调用作为回退路径。
- 增加 Python/Node 测试覆盖命令路由与 adapter 参数。
