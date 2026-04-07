# Task 6: 瘦身 server.js 到 composition root

## ✅ 完成

### 改动内容

**重构前：** 852 行  
**重构后：** 703 行  
**减少：** 149 行（17.5% 瘦身）

### 提取的模块

#### 1. `server/config/paths.js` (80 行)
所有路径常量集中管理：
- 基础目录：PROJECT_ROOT, PUBLIC_DIR, FRONTEND_DIST_DIR, CONFIG_DIR, PYTHON_DIR, DATA_DIR, UPLOADS_DIR
- Pipeline 相关：WORKFLOW_PATH, PIPELINE_DIR
- XAI Top10 相关：XAI_TOP10_DIR, XAI_TOP10_SCRIPT, XAI_TOP10_RESULT 等
- Vertical Queue 相关：VERTICAL_QUEUE_ROOT, VERTICAL_PUBLIC_DIR
- Runtime Jobs 相关：RUNTIME_ROOT
- Publish 相关：PUBLISH_CENTER_DIR, PUBLISH_CONFIG_PATH, PUBLISH_JOBS_PATH 等
- WeChat RPA 相关：WECHAT_RPA_SCRIPT, WECHAT_RPA_PROFILE_ROOT, WECHAT_RPA_TASK_DIR
- Task Store：TASK_STORE_DB_PATH

#### 2. `server/config/runtime.js` (63 行)
运行时配置和策略：
- `XAI_TOP10_FIXED_ACCOUNTS` - 固定账号列表（26 个账号）
- `RUNTIME_RETENTION_MS` - Runtime Jobs 保留时间（48 小时）
- `EDITABLE_JSON_FILES` - 可编辑的 JSON 文件白名单
- `WECHAT_ACCOUNT_FIELDS` - WeChat 账号字段
- `DEFAULT_COMFYUI_BASE_URL` - 默认 ComfyUI 地址

#### 3. `server/config/utils.js` (141 行)
工具函数集合：
- `resolveEditableJsonPath()` - 解析可编辑 JSON 文件路径
- `buildFallbackTitleFromSubtitles()` - 从字幕生成备用标题
- `createRuntimeJobDir()` - 创建运行时任务目录
- `writeMediaMetadata()` - 写入视频元数据
- `readMediaMetadata()` - 读取视频元数据
- `listProtectedRuntimeDirs()` - 列出受保护的运行时目录
- `cleanupRuntimeJobDirs()` - 清理过期的运行时任务目录
- `deepClone()` - 深度克隆对象
- `sanitizePublishDescriptionText()` - 清理发布描述文本

### 更新的引用

所有服务创建函数现在使用导入的模块：

```javascript
// 之前
const WORKFLOW_PATH = path.join(CONFIG_DIR, 'workflow_api.json');
const XAI_TOP10_FIXED_ACCOUNTS = [...];
function buildFallbackTitleFromSubtitles(subtitlesPath) { ... }

// 之后
const paths = require('./server/config/paths');
const runtime = require('./server/config/runtime');
const utils = require('./server/config/utils');

// 使用
paths.WORKFLOW_PATH
runtime.XAI_TOP10_FIXED_ACCOUNTS
utils.buildFallbackTitleFromSubtitles(subtitlesPath)
```

### 验证结果

✅ **测试通过**
```bash
npm test
# Test Suites: 4 passed, 4 total
# Tests:       30 passed, 30 total
# Time:        ~1s
```

✅ **服务器启动成功**
```
[Feishu] 飞书通知服务已启用（应用模式，支持发送图片）
[LoginStatus] 登录状态检测服务已初始化
[Scheduler] 初始化定时调度引擎 - node-cron
🚀 AI面板服务端启动成功: http://0.0.0.0:3001
```

### 架构改进

#### 之前的问题
- ❌ server.js 包含 852 行代码，职责混乱
- ❌ 路径常量、运行时配置、工具函数混在一起
- ❌ 难以维护和测试

#### 现在的状态
- ✅ server.js 只保留 composition root（703 行）
- ✅ 路径常量集中在 `server/config/paths.js`
- ✅ 运行时配置集中在 `server/config/runtime.js`
- ✅ 工具函数集中在 `server/config/utils.js`
- ✅ 依赖注入清晰可见
- ✅ 更容易测试和维护

### server.js 现在的职责

1. **依赖注入** - 创建和组装所有服务
2. **路由注册** - 注册所有 HTTP 路由
3. **服务启动** - 初始化和启动服务器

不再包含：
- ❌ 路径常量定义
- ❌ 运行时配置
- ❌ 工具函数实现

### 总结

Task 6 完成，server.js 成功瘦身 17.5%，现在是一个清晰的 composition root。所有测试通过，服务器正常启动。
