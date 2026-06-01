# 文档索引

TrendCut Studio（热点剪辑工作室）的文档已经按“长期维护”重新整理，不再保留阶段性修复记录、开发过程总结和一次性补丁说明。

## 建议阅读顺序

1. [README.md](../README.md)
2. [ARCHITECTURE_AND_REFACTOR_GUIDE.md](ARCHITECTURE_AND_REFACTOR_GUIDE.md)
3. [MATERIAL_DRIVEN_WORKFLOW.md](MATERIAL_DRIVEN_WORKFLOW.md)
4. [MODULE_GUIDE.md](MODULE_GUIDE.md)
5. [API_OVERVIEW.md](API_OVERVIEW.md)
6. [SETUP_AND_OPERATIONS.md](SETUP_AND_OPERATIONS.md)
7. [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
8. [RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)

## 文档分工

- [ARCHITECTURE_AND_REFACTOR_GUIDE.md](ARCHITECTURE_AND_REFACTOR_GUIDE.md)
  - 说明当前系统架构、核心模块和模块关系。
- [MATERIAL_DRIVEN_WORKFLOW.md](MATERIAL_DRIVEN_WORKFLOW.md)
  - 说明素材驱动主链的 7 步执行流程、关键中间文件和断点机制。
- [MODULE_GUIDE.md](MODULE_GUIDE.md)
  - 说明统一运营驾驶舱、前端组合函数与后端服务的对应关系。
- [API_OVERVIEW.md](API_OVERVIEW.md)
  - 汇总当前主要 HTTP API 分组与用途。
- [SETUP_AND_OPERATIONS.md](SETUP_AND_OPERATIONS.md)
  - 说明环境变量、依赖、自检、ComfyUI、飞书、登录检测、LLM 配置。
- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
  - 说明当前目录结构和各目录职责。
- [RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)
  - 说明源码、构建产物、运行缓存、项目产物之间的边界。

## 维护原则

- 文档只描述“当前仍有效”的功能、结构和接口。
- 单次修复、阶段总结、临时补丁不再进入 `docs` 主体。
- 如果前端模块、路由、Python 主控或运行目录发生变化，至少同步更新以下文件：
  - [README.md](../README.md)
  - [docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md](ARCHITECTURE_AND_REFACTOR_GUIDE.md)
  - [docs/MATERIAL_DRIVEN_WORKFLOW.md](MATERIAL_DRIVEN_WORKFLOW.md)
  - [docs/PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
