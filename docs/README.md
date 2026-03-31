# 文档索引

## 建议阅读顺序

1. [README.md](/Users/PC/Desktop/comfy_panel_demo/README.md)
2. [ARCHITECTURE_AND_REFACTOR_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md)
3. [PROJECT_STRUCTURE.md](/Users/PC/Desktop/comfy_panel_demo/docs/PROJECT_STRUCTURE.md)
4. [RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](/Users/PC/Desktop/comfy_panel_demo/docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)

## 文档目录

### 总览与结构

- [ARCHITECTURE_AND_REFACTOR_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md)
  当前项目架构、模块职责、业务链路和后续工程化建议。
- [PROJECT_STRUCTURE.md](/Users/PC/Desktop/comfy_panel_demo/docs/PROJECT_STRUCTURE.md)
  当前目录结构、源码目录和运行产物目录的整理说明。
- [RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](/Users/PC/Desktop/comfy_panel_demo/docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)
  源码、构建产物、任务缓存、日志、数据库和运行文件的边界说明。

### 协议与基础设施

- [ERROR_RESPONSE_CONTRACT.md](/Users/PC/Desktop/comfy_panel_demo/docs/ERROR_RESPONSE_CONTRACT.md)
  后端错误响应格式建议。
- [NODE_PYTHON_EXECUTION_PROTOCOL.md](/Users/PC/Desktop/comfy_panel_demo/docs/NODE_PYTHON_EXECUTION_PROTOCOL.md)
  Node 调 Python 的执行协议和约定。
- [STARTUP_SELF_CHECK.md](/Users/PC/Desktop/comfy_panel_demo/docs/STARTUP_SELF_CHECK.md)
  启动自检建议项。
- [SMOKE_TEST_CHECKLIST.md](/Users/PC/Desktop/comfy_panel_demo/docs/SMOKE_TEST_CHECKLIST.md)
  主链路冒烟测试清单。
- [TROUBLESHOOTING_LOG_TEMPLATE.md](/Users/PC/Desktop/comfy_panel_demo/docs/TROUBLESHOOTING_LOG_TEMPLATE.md)
  排障日志记录模板。

### LLM 与模型接入

- [LLM_PROVIDER_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/LLM_PROVIDER_GUIDE.md)
  Gemini / Qwen 切换指南。
- [LLM_MIGRATION_SUMMARY.md](/Users/PC/Desktop/comfy_panel_demo/docs/LLM_MIGRATION_SUMMARY.md)
  双提供商改造总结。

### AI 审核

- [AI_REVIEW_IMPLEMENTATION.md](/Users/PC/Desktop/comfy_panel_demo/docs/AI_REVIEW_IMPLEMENTATION.md)
  AI 审核实现细节。
- [REVIEW_CENTER_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/REVIEW_CENTER_GUIDE.md)
  审核中心使用说明。
- [REVIEW_REGENERATE_FEATURE.md](/Users/PC/Desktop/comfy_panel_demo/docs/REVIEW_REGENERATE_FEATURE.md)
  审核后重新生成功能说明。

### 发布与系统设置

- [ACCOUNT_COLLAPSE_FEATURE.md](/Users/PC/Desktop/comfy_panel_demo/docs/ACCOUNT_COLLAPSE_FEATURE.md)
  发布中心账号卡片折叠功能说明。
- [SYSTEM_SETTINGS_AND_LOGIN_CHECK_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/SYSTEM_SETTINGS_AND_LOGIN_CHECK_GUIDE.md)
  系统设置、飞书通知、登录检测和 LLM 配置说明。

### 登录检测专题

- [login-check/FEISHU_IMAGE_SETUP.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/FEISHU_IMAGE_SETUP.md)
- [login-check/LOGIN_CHECK_DIAGNOSIS.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/LOGIN_CHECK_DIAGNOSIS.md)
- [login-check/LOGIN_CHECK_FIX.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/LOGIN_CHECK_FIX.md)
- [login-check/LOGIN_CHECK_IMPROVEMENTS.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/LOGIN_CHECK_IMPROVEMENTS.md)
- [login-check/LOGIN_CHECK_OPTIMIZATION.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/LOGIN_CHECK_OPTIMIZATION.md)
- [login-check/LOGIN_CHECK_REDIRECT_FIX.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/LOGIN_CHECK_REDIRECT_FIX.md)
- [login-check/LOGIN_CHECK_URL_FIX.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/LOGIN_CHECK_URL_FIX.md)

### 历史补丁

- `docs/patches/`
  历史补丁脚本，仅用于追溯开发过程，不应视作当前生产实现入口。

## 当前文档使用原则

- 根 README 负责项目总览和启动方式。
- `ARCHITECTURE_AND_REFACTOR_GUIDE.md` 负责系统级架构说明。
- `PROJECT_STRUCTURE.md` 负责目录结构与文件边界。
- 功能专题文档负责说明单一模块或单次改造。

如果目录、模块或接口发生变化，优先同步更新这四份文档：

- [README.md](/Users/PC/Desktop/comfy_panel_demo/README.md)
- [ARCHITECTURE_AND_REFACTOR_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md)
- [PROJECT_STRUCTURE.md](/Users/PC/Desktop/comfy_panel_demo/docs/PROJECT_STRUCTURE.md)
- [RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](/Users/PC/Desktop/comfy_panel_demo/docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)
