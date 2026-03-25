# Comfy Panel Demo 架构与拆分说明

## 1. 文档目的

这份文档用于完整说明当前项目在经历前后端两轮拆分之后的最终结构、模块职责、关键调用链、运行依赖和后续维护建议。

适用场景：

- 你自己后续继续维护这个项目
- 新同事或协作者快速接手
- 以后继续做第三轮优化前，先统一对当前架构的认识

这份文档重点回答 4 个问题：

1. 这个项目现在到底是什么结构
2. 前端和后端分别拆成了哪些层
3. 每条主要业务链路是怎么流转的
4. 现在的架构还剩哪些边界和后续优化空间

---

## 2. 项目定位

`comfy_panel_demo` 已经不是简单的演示页，而是一个本地 AI 视频生产中台。

它的目标是把下面几类能力串成一套统一工作台：

- 数字人口播生成
- AI 双轨混剪
- 单条竖屏后期包装
- X 热门视频发现与批量竖屏入队
- 素材聚合与发布任务管理
- 微信视频号自动化发布

整体技术栈：

- 前端：Vue 3 组件化单页应用
- 后端：Node.js + Express
- 执行层：Python 脚本 + FFmpeg + Playwright + 外部 AI 服务
- 工作流层：ComfyUI、Gemini、xAI/X 平台相关接口

---

## 3. 当前顶层目录结构

```text
comfy_panel_demo/
  config/
  data/
  frontend/
    src/
      components/
      composables/
      App.vue
  frontend-dist/
  public/
  python/
    pipeline/
    publish/
    xai/
  server/
    core/
    routes/
    services/
  server.js
  .env
  .env.example
  env.js
  load_env.py
  docs/
    ARCHITECTURE_AND_REFACTOR_GUIDE.md
```

目录职责概览：

- `frontend/`: 新版组件化前端源码
- `frontend-dist/`: 构建后的前端产物，生产默认优先加载
- `public/`: 最终视频输出、静态预设、旧版兜底页面
- `python/pipeline/`: 混剪、字幕、标题、竖屏生成等 Python 逻辑
- `python/publish/`: 发布中心相关脚本，尤其是微信视频号 RPA
- `python/xai/`: 热点榜单抓取、翻译和账号配置
- `config/`: 工作流模板与后续可扩展配置
- `data/`: 运行期上传、队列目录和临时任务数据
- `server/`: 后端拆分后的模块目录
- `server.js`: 当前 Node 服务装配入口

---

## 4. 前端拆分结果

### 4.1 前端拆分目标

前端第一阶段的问题是单页面逻辑过重，状态和交互全混在一起，维护成本高。

前端拆分后的目标是：

- 让每个业务域有独立工作区组件
- 让状态和 API 调用下沉到 composable
- 保留统一壳层、导航、主题和卡片风格

### 4.2 当前前端目录

```text
frontend/src/
  App.vue
  main.js
  styles.css
  components/
    ConsoleHero.vue
    PipelineWorkspace.vue
    PublishCenterWorkspace.vue
    RunLogPanel.vue
    StandaloneWorkspace.vue
    TopNavigation.vue
    XaiDiscoveryWorkspace.vue
  composables/
    usePipeline.js
    usePublishCenter.js
    useStandalone.js
    useVerticalQueue.js
    useXaiTop10.js
```

### 4.3 前端壳层职责

入口文件：

- `frontend/src/App.vue`

它负责：

- 管理主题切换
- 管理顶部导航
- 切换四个核心工作区
- 在挂载时统一触发模块初始化
- 控制自动刷新生命周期

四个主工作区：

- `pipeline`
- `standalone`
- `xaiTop10`
- `publishCenter`

### 4.4 前端组件职责

`TopNavigation.vue`

- 顶部模块切换导航
- 展示当前模块标题与描述

`PipelineWorkspace.vue`

- 数字人渲染表单
- 双轨混剪表单
- 进度、日志、结果视频展示

`StandaloneWorkspace.vue`

- 单条竖屏视频上传
- 字幕 / ASR 选项
- 队列状态查看
- 成品预览

`XaiDiscoveryWorkspace.vue`

- 热点榜单结果展示
- 账号池配置
- 结果导出
- 批量送入竖屏队列

`PublishCenterWorkspace.vue`

- 平台配置
- 素材列表
- 发布任务创建与筛选
- 微信视频号执行与重试 / 取消

`RunLogPanel.vue`

- 通用日志展示面板

### 4.5 前端 composable 职责

`usePipeline.js`

- 管理数字人渲染和混剪状态
- 连接 `/api/progress`
- 调用 `/api/generate`
- 调用 `/api/run-pipeline`
- 调用 `/api/optimize-text`
- 调用 `/api/convert-video`

`useStandalone.js`

- 管理单条竖屏表单
- 调用 `/api/generate-vertical-standalone`
- 拉取 `/api/xai-top10/vertical-jobs`
- 管理竖屏任务取消与删除

`useXaiTop10.js`

- 调用 `/api/xai-top10/result`
- 调用 `/api/xai-top10/status`
- 调用 `/api/xai-top10/config`
- 调用 `/api/xai-top10/run`
- 调用 `/api/xai-top10/vertical-jobs`
- 维护榜单选中与批量入队状态

`usePublishCenter.js`

- 调用 `/api/publish/config`
- 调用 `/api/publish/assets`
- 调用 `/api/publish/jobs`
- 调用微信视频号执行相关接口
- 管理平台配置编辑器与发布表单

`useVerticalQueue.js`

- 作为竖屏队列的辅助状态层

### 4.6 前端拆分收益

- `App.vue` 负责页面装配，不再直接吞下所有业务逻辑
- 状态管理按模块归位，排障更容易
- 同一工作台下的四块业务边界更清晰
- 后续新增模块或替换某块接口时，不需要继续堆到单文件里

---

## 5. 后端拆分结果

### 5.1 后端拆分前问题

原始 `server.js` 同时承担了这些职责：

- 静态资源入口
- SSE 进度推送
- ComfyUI 调用
- 混剪任务调度
- XAI 热点榜单
- 竖屏队列
- 发布中心
- 微信视频号自动化
- 配置读写
- JSON 文件编辑接口

这会带来：

- 业务耦合严重
- 状态共享不透明
- 新功能容易互相影响
- 很难做局部测试和局部修改

### 5.2 当前后端目录

```text
server/
  core/
    progress.js
    runtime.js
  routes/
    pipeline.js
    publish.js
    standalone.js
    system.js
    vertical.js
    xai.js
  services/
    pipeline/
      comfy.js
      handlers.js
      workflow.js
    publish/
      assets.js
      handlers.js
      store.js
      wechatRpa.js
    system/
      handlers.js
    vertical/
      queue.js
      standalone.js
    xai/
      service.js
```

### 5.3 当前 `server.js` 的角色

现在的 `server.js` 已经从“大一统实现文件”转成了“应用装配入口”。

它当前主要负责：

- 加载环境变量
- 定义路径常量
- 创建 Express 应用
- 注册静态资源
- 创建各 service 的依赖
- 注册 route
- 创建必要目录
- 启动服务

也就是说，`server.js` 现在更像 bootstrap / composition root，而不是业务实现本体。

---

## 6. 后端核心层说明

### 6.1 `server/core/runtime.js`

职责：

- 文件与目录工具
- JSON 读写
- 运行时目录管理
- 进程控制
- 文本清洗与日志辅助

典型能力：

- `ensureDir`
- `writeJsonFile`
- `readJsonIfExists`
- `tailLines`
- `makeJobId`
- `stopProcessTree`
- `removeDirIfExists`

这一层是后端所有业务的公共基础设施。

### 6.2 `server/core/progress.js`

职责：

- SSE 客户端注册与管理
- `/api/progress` 路由挂载
- 向指定 `clientId` 推送进度事件

它解决的问题是：

- 各业务模块不需要再自己维护 `clients`
- 前端进度流格式统一

---

## 7. 后端业务模块说明

### 7.1 Pipeline 模块

相关文件：

- `server/routes/pipeline.js`
- `server/services/pipeline/workflow.js`
- `server/services/pipeline/comfy.js`
- `server/services/pipeline/handlers.js`

职责拆分：

`workflow.js`

- 读取 `workflow_api.json`
- 提取工作流配置
- 应用配置回写到工作流模板

`comfy.js`

- 上传资源到 ComfyUI
- 监听 ComfyUI 进度
- 等待任务完成

`handlers.js`

- 处理 `/api/generate`
- 处理 `/api/run-pipeline`
- 协调运行时目录、SSE、脚本执行

典型链路：

1. 前端调用 `/api/generate`
2. 服务端准备工作流和上传素材
3. 调用 ComfyUI 生成数字人口播
4. 返回 `videoUrl`
5. 前端再调用 `/api/run-pipeline`
6. 后端串行执行 Python 脚本完成混剪

### 7.2 XAI 热点榜单模块

相关文件：

- `server/routes/xai.js`
- `server/services/xai/service.js`

职责：

- 榜单结果读取
- 榜单运行状态输出
- 账号池配置持久化
- 调用 `python/xai/run_xai_top10.py`
- 翻译结果补全

典型接口：

- `/api/xai-top10/result`
- `/api/xai-top10/status`
- `/api/xai-top10/config`
- `/api/xai-top10/run`

### 7.3 Vertical Queue 模块

相关文件：

- `server/routes/vertical.js`
- `server/services/vertical/queue.js`

职责：

- 热点视频批量入队
- 队列并发控制
- 单任务状态更新
- 取消 / 删除任务
- 执行下载、ASR、标题生成、竖屏渲染

典型接口：

- `/api/xai-top10/vertical-jobs`
- `/api/xai-top10/vertical-jobs/:jobId/cancel`
- `/api/xai-top10/vertical-jobs/:jobId`

### 7.4 Standalone 模块

相关文件：

- `server/routes/standalone.js`
- `server/services/vertical/standalone.js`

职责：

- 单条竖屏视频的独立处理
- 可选 SRT / 可选 ASR
- 标题生成
- 输出竖屏结果

典型接口：

- `/api/generate-vertical-standalone`

### 7.5 Publish 模块

这是本项目拆分中最复杂的一块，当前已经拆成了 5 层。

相关文件：

- `server/routes/publish.js`
- `server/services/publish/handlers.js`
- `server/services/publish/store.js`
- `server/services/publish/assets.js`
- `server/services/publish/wechatRpa.js`

职责拆分如下。

#### 7.5.1 `publish/handlers.js`

职责：

- 接住 publish 相关 API 请求
- 调用 store / assets / wechatRpa 层完成实际工作

接口包括：

- `/api/publish/config`
- `/api/publish/assets`
- `/api/publish/jobs`
- `/api/publish/jobs/:jobId/archive`
- `/api/publish/jobs/:jobId/unarchive`
- `/api/publish/jobs/archive-completed`
- `/api/publish/jobs/:jobId/wechat-channels`
- `/api/publish/jobs/:jobId/wechat-channels/retry`
- `/api/publish/jobs/:jobId/wechat-channels/cancel`

#### 7.5.2 `publish/store.js`

职责：

- 平台配置归一化
- 微信视频号账号配置清洗
- 发布任务 JSON 持久化
- 归档逻辑
- 平台校验逻辑
- 任务 reconcile

它是 publish 模块的数据层和配置层。

#### 7.5.3 `publish/assets.js`

职责：

- 收集可发布素材
- 维护素材缓存
- 构建素材展示信息
- 生成建议标题、标签、摘要

素材来源：

- `public/output_final.mp4`
- `public/standalone_output_vertical.mp4`
- `public/xai_vertical_queue/.../vertical_output.mp4`

#### 7.5.4 `publish/wechatRpa.js`

职责：

- 维护视频号发布运行中的进程表
- 生成微信视频号发布 payload
- 启动 `wechat_channels_rpa.py`
- 解析日志和状态
- 写回发布任务运行状态
- 重试与取消

这是发布中心最重的一块执行层逻辑。

#### 7.5.5 `publish/routes.js`

职责：

- 只负责将 HTTP 接口绑定到 handler

### 7.6 System 模块

这是后期收尾新补的一层，用来承接不属于某个独立业务域的系统接口。

相关文件：

- `server/routes/system.js`
- `server/services/system/handlers.js`

职责：

- 预设列表接口
- workflow 配置读写
- JSON 文件读写
- 文案润色
- 视频比例转换

典型接口：

- `/api/presets`
- `/api/workflow-config`
- `/api/json-files`
- `/api/optimize-text`
- `/api/convert-video`

---

## 8. 关键业务链路

### 8.1 数字人口播 + AI 混剪链路

前端入口：

- `usePipeline.js`

后端入口：

- `/api/generate`
- `/api/run-pipeline`

执行路径：

1. 前端组装渲染参数
2. 建立 `/api/progress?clientId=...` 的 SSE
3. `/api/generate` 调用 ComfyUI 生成 `aiman.mp4`
4. `/api/run-pipeline` 调用 Python 脚本链
5. 最终输出 `public/output_final.mp4`

Python 关键脚本：

- `python/pipeline/run_asr.py`
- `python/pipeline/video_vlm.py`
- `python/pipeline/run_director.py`
- `python/pipeline/build_video.py`

### 8.2 单条竖屏链路

前端入口：

- `useStandalone.js`

后端入口：

- `/api/generate-vertical-standalone`

执行路径：

1. 上传视频和可选字幕
2. 必要时执行 ASR
3. 必要时自动生成标题
4. 调用 `make_vertical_video.py`
5. 输出 `public/standalone_output_vertical.mp4`

### 8.3 XAI 热点榜单链路

前端入口：

- `useXaiTop10.js`

后端入口：

- `/api/xai-top10/run`

执行路径：

1. 读取账号池配置
2. 调用 `python/xai/run_xai_top10.py`
3. 生成 `result.json`
4. 在前端展示榜单
5. 选中结果后送入竖屏队列

### 8.4 热点批量竖屏链路

前端入口：

- `useXaiTop10.js`
- `useStandalone.js`

后端入口：

- `/api/xai-top10/vertical-jobs`

执行路径：

1. 榜单项被送入队列
2. 后端创建每个 job 的工作目录
3. 下载远程视频
4. 执行 ASR / 标题生成 / 竖屏渲染
5. 成品落到 `public/xai_vertical_queue/...`
6. 发布中心素材池可读取该结果

### 8.5 发布中心链路

前端入口：

- `usePublishCenter.js`

后端入口：

- `/api/publish/assets`
- `/api/publish/jobs`
- `/api/publish/jobs/:jobId/wechat-channels`

执行路径：

1. `publish/assets` 聚合可发布素材
2. 前端选择素材并编辑标题、描述、平台
3. `publish/store` 创建发布任务
4. 微信视频号任务走 `publish/wechatRpa`
5. RPA 过程中的状态和日志回写到任务对象

---

## 9. 运行时文件与状态存储

### 9.1 主要配置文件

- `config/workflow_api.json`
- `.env`
- `python/publish/platform_config.json`
- `python/xai/xai_accounts.json`

### 9.2 主要中间产物

- `python/pipeline/audio.json`
- `python/pipeline/result.json`
- `python/pipeline/director.json`
- `python/pipeline/subtitles.json`
- `data/uploads/runtime_jobs/...`
- `data/uploads/xai_vertical_queue/...`

### 9.3 主要最终产物

- `public/output_final.mp4`
- `public/standalone_output_vertical.mp4`
- `public/xai_vertical_queue/<jobId>/vertical_output.mp4`

### 9.4 后端当前状态管理方式

当前仍然是“单机 JSON 文件 + 内存状态”的组合：

- 配置存在 JSON
- 发布任务存在 JSON
- 某些运行中状态存在内存 Map
- 队列状态由 service 单例维护

这很适合当前单机本地工作台，但不适合多人并发或分布式部署。

---

## 10. 环境变量与配置治理

这次重构前，项目里存在硬编码配置和密钥。

现在已经统一为环境变量优先，支持项目根目录 `.env`。

关键变量包括：

- `PORT`
- `HOST`
- `COMFYUI_BASE_URL`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `GEMINI_MODEL`
- `PUBLISH_DESCRIPTION_GEMINI_MODEL`
- `XAI_API_KEY`
- `XAI_MODEL`
- `XAI_TOP10_CANDIDATE_WORKERS`
- `XAI_TOP10_ENRICH_WORKERS`
- `XAI_TOP10_FOLLOWER_WORKERS`

辅助文件：

- `env.js`
- `load_env.py`
- `.env.example`

---

## 11. 这两轮拆分的核心收益

### 11.1 前端收益

- 单文件前端被拆成工作区 + composable
- 交互和状态边界更清晰
- 未来新增模块时不会继续堆到 `App.vue`

### 11.2 后端收益

- `server.js` 从超大单文件下降到当前装配入口
- 核心业务域有独立模块
- 公共基础设施被抽离
- 发布中心这块高复杂度逻辑被真正拆层
- 后续继续优化时，可以针对单一模块下刀

### 11.3 维护收益

- 改动影响范围更可控
- 更容易定位某条业务链路在哪里
- 更容易做模块级测试和日志排查
- 新成员更容易理解系统

---

## 12. 当前仍然保留在 `server.js` 的内容

目前 `server.js` 仍然保留这些内容是合理的：

- Express 启动入口
- 路径常量定义
- 项目级目录初始化
- service 装配和依赖注入
- 少量跨模块通用 helper

这些内容保留在入口文件里，能让整体装配关系一眼可见，不建议继续为了“纯粹拆干净”而过度切碎。

---

## 13. 后续优化建议

### 13.1 优先级高

- 做运行级回归测试，而不只停留在 `node --check`
- 给关键模块补最小 smoke test
- 给主要业务链路补一份失败排障清单

### 13.2 中优先级

- 把 JSON 状态逐步迁到 SQLite
- 给任务增加更明确的状态机定义
- 增强日志结构化程度

### 13.3 低优先级

- 把更多通用 helper 再下沉
- 做更完整的模块文档与调用图
- 对前端进一步抽公共日志和卡片组件

---

## 14. 当前判断：是否还有必要继续大拆

结论是：

- 业务大块已经拆完
- 当前更适合转入验证、文档和小步优化
- 不建议继续进行大规模“第三轮结构拆分”

最合理的下一阶段工作应该是：

1. 跑关键功能回归
2. 补必要测试
3. 优化日志、错误恢复和任务持久化

也就是说，现在已经到了“结构稳定期”，而不是“继续开大手术期”。

---

## 15. 一句话总结

这个项目已经从“单体本地 AI 视频面板”演进成了“前端组件化 + 后端服务分层 + Python 执行链独立”的本地内容生产中台，当前架构已经具备继续长期维护和继续增量迭代的基础。
