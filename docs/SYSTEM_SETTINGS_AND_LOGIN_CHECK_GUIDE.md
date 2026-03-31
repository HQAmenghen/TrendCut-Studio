# 系统设置与登录检测说明

这份文档用于说明当前“系统设置”模块覆盖的能力，以及它和登录检测、飞书通知、LLM 配置之间的关系。

## 1. 模块范围

当前系统设置主要覆盖：

- 飞书通知配置
- 登录检测配置
- LLM 提供商与模型配置
- 系统自检入口
- 部分系统级 JSON / workflow 配置

前端入口：

- `frontend/src/components/SystemSettingsWorkspace.vue`

后端入口：

- `server/routes/system.js`
- `server/routes/loginStatus.js`

## 2. 系统设置相关接口

### 2.1 系统接口

来自 `server/routes/system.js`：

- `GET /api/system/self-check`
- `GET /api/system/feishu-config`
- `POST /api/system/feishu-config`
- `GET /api/system/login-check-config`
- `POST /api/system/login-check-config`
- `GET /api/system/llm-config`
- `POST /api/system/llm-config`
- `GET /api/workflow-config`
- `POST /api/workflow-config`
- `GET /api/json-files`
- `GET /api/json-files/:fileName`
- `POST /api/json-files/:fileName`

### 2.2 登录检测接口

来自 `server/routes/loginStatus.js`：

- `POST /api/login-status/check-all`
- `POST /api/login-status/check-batch`
- `POST /api/login-status/check/:accountId`
- `GET /api/login-status/all`
- `GET /api/login-status/:accountId`
- `DELETE /api/login-status/cache/:accountId?`
- `POST /api/login-status/test-feishu`

## 3. 后端服务关系

### 3.1 系统设置主服务

- `server/services/system/handlers.js`

负责：

- 读取和写入飞书配置
- 读取和写入登录检测配置
- 读取和写入 LLM 配置
- 自检、workflow 配置和 JSON 文件编辑

### 3.2 自检服务

- `server/services/system/selfCheck.js`

负责：

- 环境变量检查
- 命令依赖检查
- 关键目录检查
- 关键脚本检查

### 3.3 登录检测服务

- `server/services/notification/loginStatus.js`

负责：

- 读取发布账号配置
- 检查单个或多个账号状态
- 缓存检测结果
- 输出账号状态摘要

### 3.4 飞书服务

- `server/services/notification/feishu.js`

负责：

- 文本通知
- 图片通知
- 测试通知

## 4. Python 脚本

登录检测和发布相关脚本位于：

- `python/publish/wechat_check_login.py`
- `python/publish/wechat_check_login_remote.py`
- `python/publish/wechat_channels_rpa.py`

说明：

- 登录检测脚本用于检查视频号登录状态
- 发布脚本用于真正的发布流程
- 两者相关，但不是同一条执行链路

## 5. 配置来源

当前系统设置依赖这些配置：

- `.env`
- `python/publish/platform_config.json`
- `python/xai/xai_accounts.json`
- `config/workflow_api.json`

常见环境变量包括：

- `FEISHU_WEBHOOK_URL`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `LOGIN_CHECK_ENABLED`
- `LOGIN_CHECK_INTERVAL_MINUTES`
- `LOGIN_CHECK_RETRY_TIMES`
- `LLM_PROVIDER`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `QWEN_API_KEY`

## 6. 运行逻辑说明

### 6.1 登录检测

登录检测通常依赖发布中心里配置好的微信视频号账号列表。

执行流程：

1. 读取平台配置
2. 取出微信视频号账号
3. 按单个、批量或全部账号方式执行检查
4. 更新状态缓存
5. 视配置决定是否发送飞书通知

### 6.2 飞书通知

飞书通知可用于：

- 登录状态提醒
- 定时任务通知
- 测试通知

### 6.3 LLM 配置

当前 LLM 配置用于：

- 标题生成
- 文案优化
- 审核分析
- 翻译与描述生成

相关说明可继续参考 [LLM_PROVIDER_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/LLM_PROVIDER_GUIDE.md)。

## 7. 排障建议

### 7.1 登录检测失败

优先检查：

- 微信账号配置是否完整
- 浏览器/RPA 依赖是否可用
- 登录检测配置是否启用
- 对应 Python 脚本是否存在

### 7.2 飞书通知失败

优先检查：

- `FEISHU_WEBHOOK_URL`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- 接收对象配置

### 7.3 自检失败

优先查看：

- `GET /api/system/self-check`
- `docs/STARTUP_SELF_CHECK.md`

### 7.4 LLM 配置异常

优先检查：

- 当前 `LLM_PROVIDER`
- 对应提供商 API Key
- 当前模型名是否存在

## 8. 当前限制

- 登录检测状态目前仍有一部分依赖内存缓存
- 登录检测和发布账号配置存在耦合
- 系统设置相关能力目前分散在多个配置文件和服务中

## 9. 推荐维护顺序

接手系统设置相关功能时，建议按以下顺序阅读：

1. `server/routes/system.js`
2. `server/routes/loginStatus.js`
3. `server/services/system/handlers.js`
4. `server/services/notification/loginStatus.js`
5. `server/services/notification/feishu.js`
6. `python/publish/wechat_check_login.py`
