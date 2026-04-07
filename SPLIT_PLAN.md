# 拆分计划：wechatRpa.js 和 store.js

## 文件大小
- `wechatRpa.js`: 584 行
- `store.js`: 593 行
- **总计**: 1177 行

## wechatRpa.js 拆分方案

### 当前结构分析

**状态管理：**
- `publishRuntimeProcesses` - 发布进程映射
- `keepAliveProcesses` - 保活进程映射
- `loginCheckSessions` - 登录检查会话映射

**登录相关函数（~150 行）：**
- `buildLoginCheckResponse()` - 构建登录检查响应
- `finalizeLoginCheckSession()` - 结束登录检查会话
- `scheduleLoginCheckCleanup()` - 调度登录检查清理
- `checkWechatLogin()` - 检查微信登录状态（主函数，~150 行）

**进程管理函数（~200 行）：**
- `stopWechatRpaProcess()` - 停止 RPA 进程
- `getActiveWechatRuntimeForAccount()` - 获取账号的活跃运行时
- `startWechatRpa()` - 启动 RPA（主函数，~180 行）
- `retryWechatRpa()` - 重试 RPA
- `cancelWechatRpa()` - 取消 RPA

**运行时管理函数（~100 行）：**
- `readWechatRuntimeLogs()` - 读取运行时日志
- `appendWechatRuntimeLog()` - 追加运行时日志
- `parseWechatRpaLine()` - 解析 RPA 状态行
- `parseWechatLogLine()` - 解析日志行
- `getWechatStateProgress()` - 获取状态进度

**工具函数（~50 行）：**
- `buildWechatProfileDir()` - 构建配置目录
- `buildWechatPublishPayload()` - 构建发布 payload
- `safeUpdatePublishPlatformTask()` - 安全更新任务

### 拆分方案

#### 1. `wechatRpa.login.js` (~200 行)
**职责：** 登录检查和会话管理

**导出：**
- `createWechatLoginService(deps)`
  - `checkWechatLogin(accountId, options)`
  - `buildLoginCheckResponse(session)`
  - `finalizeLoginCheckSession(accountId, options)`
  - `scheduleLoginCheckCleanup(accountId, delayMs)`

**依赖：**
- `fs`, `path`, `spawn`
- `stopProcessTree`
- `wechatRpaScript`, `wechatRpaProfileRoot`
- `buildWechatProfileDir` (内部)

#### 2. `wechatRpa.process.js` (~250 行)
**职责：** RPA 进程启动、重试、取消

**导出：**
- `createWechatProcessService(deps)`
  - `startWechatRpa(jobId, publishMode)`
  - `retryWechatRpa(jobId, mode)`
  - `cancelWechatRpa(jobId)`
  - `stopWechatRpaProcess(runtimeEntry)`
  - `getActiveWechatRuntimeForAccount(accountId)`

**依赖：**
- `fs`, `path`, `spawn`
- `stopProcessTree`, `slugifyText`
- `wechatRpaScript`, `wechatRpaTaskDir`, `wechatRpaProfileRoot`
- `readPublishJobs`, `readPublishConfig`, `validateWechatTaskConfig`
- `updatePublishPlatformTask`, `buildShortTitle`
- `wechatRpa.runtime` (运行时管理)

#### 3. `wechatRpa.runtime.js` (~150 行)
**职责：** 运行时状态管理、日志管理、协议解析

**导出：**
- `createWechatRuntimeService(deps)`
  - `readWechatRuntimeLogs(jobId)`
  - `appendWechatRuntimeLog(jobId, line, publishMode, state, message, progress)`
  - `parseWechatRpaLine(line)`
  - `parseWechatLogLine(line)`
  - `getWechatStateProgress(state)`
  - `buildWechatPublishPayload(job, wechatAccount)`
  - `buildWechatProfileDir(accountId)`

**依赖：**
- `path`, `slugifyText`
- `readPublishJobs`, `updatePublishPlatformTask`
- `buildShortTitle`

---

## store.js 拆分方案

### 当前结构分析

**数据库相关（~80 行）：**
- SQLite 初始化
- 从 JSON 迁移到 SQLite
- `readPublishJobs()` - 读取任务
- `writePublishJobs()` - 写入任务
- `updatePublishJob()` - 更新任务

**配置管理（~150 行）：**
- `createEmptyWechatAccount()` - 创建空账号
- `sanitizeWechatAccounts()` - 清理账号列表
- `normalizePublishConfig()` - 规范化配置
- `getWechatAccountMap()` - 获取账号映射
- `readPublishConfig()` - 读取配置
- `writePublishConfig()` - 写入配置
- `maskSecretValue()` - 掩码敏感值
- `maskPlatformConfig()` - 掩码平台配置

**任务管理（~200 行）：**
- `sanitizePublishJobPayload()` - 清理任务 payload
- `getJobTerminalStatus()` - 获取任务终态
- `updatePublishPlatformTask()` - 更新平台任务
- `archivePublishJob()` - 归档任务
- `archiveCompletedPublishJobs()` - 归档已完成任务
- `reconcilePlatformTask()` - 协调平台任务
- `reconcilePublishJob()` - 协调发布任务
- `reconcileAndPersistPublishJobs()` - 协调并持久化任务
- `getDueScheduledJobs()` - 获取到期的定时任务

**验证相关（~100 行）：**
- `formatPlatformFieldLabel()` - 格式化字段标签
- `collectPlatformValidation()` - 收集平台验证
- `sanitizePlatformConfigInput()` - 清理平台配置输入
- `validateWechatTaskConfig()` - 验证微信任务配置

**工具函数（~50 行）：**
- `sanitizePublishDescriptionText()` - 清理发布描述

### 拆分方案

#### 1. `publishStore.config.js` (~200 行)
**职责：** 平台配置管理（读写、验证、掩码）

**导出：**
- `createPublishConfigService(deps)`
  - `readPublishConfig()`
  - `writePublishConfig(config)`
  - `normalizePublishConfig(config)`
  - `maskPlatformConfig(config)`
  - `sanitizePlatformConfigInput(input)`
  - `collectPlatformValidation(platformKey, platformConfig, requiredFields)`
  - `validateWechatTaskConfig(platformConfig, task)`
  - `getWechatAccountMap(config)`
  - `createEmptyWechatAccount()`
  - `sanitizeWechatAccounts(accounts)`

**依赖：**
- `publishConfigPath`, `wechatAccountFields`
- `readJsonIfExists`, `writeJsonFile`, `deepClone`

#### 2. `publishStore.jobs.js` (~250 行)
**职责：** 任务 CRUD、协调、归档

**导出：**
- `createPublishJobsService(deps)`
  - `readPublishJobs()`
  - `writePublishJobs(payload)`
  - `updatePublishJob(jobId, updater)`
  - `updatePublishPlatformTask(jobId, platformKey, patch)`
  - `archivePublishJob(jobId, archived)`
  - `archiveCompletedPublishJobs()`
  - `reconcilePlatformTask(platformKey, existingTask, publishData, assetUrl, platformConfig, selection)`
  - `reconcilePublishJob(job, config)`
  - `reconcileAndPersistPublishJobs(config)`
  - `getDueScheduledJobs(timestamp)`
  - `sanitizePublishJobPayload(payload)`
  - `getJobTerminalStatus(job)`

**依赖：**
- `publishJobsPath`, `readJsonIfExists`, `writeJsonFile`, `deepClone`, `makeJobId`, `buildPublishTask`
- `publishStore.migrations` (数据库初始化)

#### 3. `publishStore.migrations.js` (~100 行)
**职责：** 数据库初始化、迁移

**导出：**
- `createPublishDatabase(publishJobsPath)`
  - 返回 `{ db, migrate }`
  - `db` - SQLite 数据库实例
  - `migrate()` - 执行迁移（从 JSON 到 SQLite）

**依赖：**
- `better-sqlite3`, `fs`, `path`
- `readJsonIfExists`

---

## 拆分顺序

1. **wechatRpa.runtime.js** - 最独立，无循环依赖
2. **wechatRpa.login.js** - 依赖 runtime
3. **wechatRpa.process.js** - 依赖 runtime 和 login
4. **publishStore.migrations.js** - 最独立
5. **publishStore.config.js** - 依赖 migrations
6. **publishStore.jobs.js** - 依赖 migrations 和 config
7. **更新 wechatRpa.js** - 组装三个子模块
8. **更新 store.js** - 组装三个子模块

---

## 预期收益

### wechatRpa.js
- **拆分前**: 584 行
- **拆分后**:
  - `wechatRpa.runtime.js`: ~150 行
  - `wechatRpa.login.js`: ~200 行
  - `wechatRpa.process.js`: ~250 行
  - `wechatRpa.js` (组装): ~50 行
- **总计**: ~650 行（增加 ~70 行组装代码）

### store.js
- **拆分前**: 593 行
- **拆分后**:
  - `publishStore.migrations.js`: ~100 行
  - `publishStore.config.js`: ~200 行
  - `publishStore.jobs.js`: ~250 行
  - `store.js` (组装): ~50 行
- **总计**: ~600 行（增加 ~10 行组装代码）

### 整体
- **拆分前**: 1177 行（2 个文件）
- **拆分后**: 1250 行（8 个文件）
- **单文件最大**: 250 行（从 593 行降低 58%）
- **职责清晰**: 每个文件单一职责，易于测试和维护
