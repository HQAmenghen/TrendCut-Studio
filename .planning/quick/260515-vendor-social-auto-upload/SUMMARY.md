---
status: complete
quick_id: 260515-vendor-sau
completed: 2026-05-15
---

将 social-auto-upload 从外部路径适配改为项目内 vendor 集成。

完成内容：
- 新增 `vendor/social-auto-upload/` 精简源码副本，包含抖音、小红书上传链路和共享浏览器工具。
- 排除 `.venv`、cookies、logs、db、示例视频、生成资产和无关平台 uploader。
- Node 默认使用 `vendor/social-auto-upload`，仅在高级覆盖时读取 `SOCIAL_AUTO_UPLOAD_DIR`。
- Python 适配器移除对 `sau_cli` 的依赖，账号 cookie 由当前项目写入 `data/social-auto-upload-runtime/cookies/`。
- vendor 配置和日志模块改为使用 `SOCIAL_AUTO_UPLOAD_RUNTIME_DIR`，避免运行状态写入源码目录。
- 当前项目 Python 依赖补充 `patchright`、`loguru`、`opencv-python`、`qrcode`、`segno`。
- README 和 `.dockerignore` 更新打包边界说明。

验证：
- `python -m pip install --disable-pip-version-check "patchright==1.58.2" "loguru==0.7.3" "opencv-python>=4.13.0.92" "qrcode==8.2" "segno>=1.6.6"`
- vendor import smoke：确认 `BASE_DIR` 指向 `vendor/social-auto-upload`，`RUNTIME_DIR` 指向 runtime 目录。
- `python -m unittest python.tests.test_social_auto_upload_adapter python.tests.test_browser_platform_rpa python.tests.test_wechat_channels_rpa`
- `npx jest server/services/publish/__tests__/platformRpa.test.js --runInBand`
- `npm run lint`
- `npm run build:front`
