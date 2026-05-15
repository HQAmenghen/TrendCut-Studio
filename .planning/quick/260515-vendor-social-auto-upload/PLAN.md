---
status: in-progress
quick_id: 260515-vendor-sau
created: 2026-05-15
---

将 social-auto-upload 从外部路径适配改为项目内 vendor 集成。

目标：
- 将可复用源码纳入 `vendor/social-auto-upload/`，随当前项目一起打包。
- 不纳入 `.venv`、cookies、logs、db、media、videos 等运行态或账号相关内容。
- Node 默认优先使用项目内 vendor 目录，环境变量仅作为高级覆盖。
- Python 适配器将账号 cookie/logs 写入当前项目运行目录，避免污染 vendor 源码。
- 补充依赖、文档和测试。
