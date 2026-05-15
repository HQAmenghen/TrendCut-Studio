---
status: complete
quick_id: 260515-jby
completed: 2026-05-15
---

自动发现 social-auto-upload 本地路径和虚拟环境。

完成内容：
- `server/services/publish/platformRpa.js` 默认查找 `SOCIAL_AUTO_UPLOAD_DIR` / `SOCIAL_AUTO_UPLOAD_HOME`，再查找 `C:\Users\<user>\social-auto-upload`、`$HOME/social-auto-upload` 和当前项目同级目录。
- 默认查找 social-auto-upload checkout 内的 `.venv` / `venv` Python；找不到时才回退到 `python`。
- 保留 `SOCIAL_AUTO_UPLOAD_DIR` / `SOCIAL_AUTO_UPLOAD_PYTHON` 作为高级覆盖项，适用于 checkout 或 Python 环境不在默认位置的机器。
- README 改为说明这两个路径不是必填配置。
- 发布 RPA 单测覆盖默认发现 `USERPROFILE\social-auto-upload` 的路径。

验证：
- `npx jest server/services/publish/__tests__/platformRpa.test.js --runInBand`
- `npm run lint`
- `npm run build:front`
