---
status: in-progress
quick_id: 260515-jby
created: 2026-05-15
---

自动发现 social-auto-upload 本地路径和虚拟环境。

目标：
- 默认发现 `C:\Users\<user>\social-auto-upload`，不要求操作者手填路径。
- 默认发现该项目 `.venv\Scripts\python.exe`，否则回退到 `python`。
- 保留 `SOCIAL_AUTO_UPLOAD_DIR` / `SOCIAL_AUTO_UPLOAD_PYTHON` 作为高级覆盖项。
- 更新文档和测试，减少配置心智负担。
