# TrendCut Studio 环境与运维

## 基础依赖

启动项目前建议准备：

- Node.js 18+
- Python 3.10+
- FFmpeg
- 如果要跑微信视频号自动化，还需要 Playwright Python 依赖

TrendCut Studio 是本地热点视频剪辑运营系统，外部依赖不会随仓库自动启动。ComfyUI、LLM Provider、FFmpeg、Playwright 浏览器和平台账号登录态需要在运行环境中单独准备。

## 安装

```powershell
npm install
pip install -r requirements.lock.txt
```

`python/pipeline/requirements.txt` 是直接依赖清单，`requirements.lock.txt` 是提交到仓库的可复现安装锁文件。修改 Python 依赖后需要同步更新锁文件并运行：

```powershell
npm run check:py-lock
```

微信视频号或其他平台 RPA 需要浏览器二进制：

```powershell
python -m playwright install chromium
```

## 环境变量

从模板开始：

```powershell
Copy-Item .env.example .env
```

## 重点变量

### 素材驱动与数字人

- `COMFYUI_BASE_URL`
  - ComfyUI 服务地址

### LLM

- `LLM_PROVIDER`
  - 当前支持 `gemini` 和 `qwen`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `GEMINI_MODEL`
- `QWEN_API_KEY`
- `QWEN_TEXT_MODEL`
- `QWEN_VL_MODEL`
- `QWEN_ASR_MODEL`

### 热点榜单

- `XAI_API_KEY`

### 审核

- `AI_REVIEW_ENABLED`

### 飞书与登录检测

- `FEISHU_WEBHOOK_URL`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `LOGIN_CHECK_ENABLED`
- `LOGIN_CHECK_INTERVAL_MINUTES`
- `LOGIN_CHECK_RETRY_TIMES`

## 系统设置接口能力

当前系统设置页可以直接管理：

- 预设素材
- 自检
- 工作流配置
- JSON 配置文件
- 文案优化
- 飞书配置
- 登录检测
- LLM 提供商

对应后端实现位于：

- `server/services/system/handlers.js`

## 自检

接口：

- `GET /api/system/self-check`

当前会检查：

- 关键环境变量
- 关键目录和脚本
- Python
- FFmpeg
- 关键 Python 包导入
- Playwright Python 与浏览器
- ComfyUI 地址配置

自检不会代替真实发布或真实渲染，但会在任务启动前暴露常见离线/缺依赖状态。`warn` 表示相关能力不可用但主服务仍可启动，`fail` 表示核心运行依赖缺失。

## ComfyUI 使用说明

素材驱动链路开启自动数字人时：

1. 前端先提交素材与数字人配置。
2. Python 主控先执行到步骤 5。
3. Node 再把音频和图片上传到 ComfyUI。
4. ComfyUI 生成内部数字人视频文件 `aiman.mp4`。
5. 工作流从步骤 6 继续。

连通性测试接口：

- `POST /api/material-driven/test-comfy`

## 微信视频号发布

当前实现方式：

- 不是官方统一直发 API
- 而是基于 Web 端流程的 RPA 自动化

核心文件：

- `server/services/publish/wechatRpa.js`
- `python/publish/wechat_channels_rpa.py`

## 登录检测与飞书

相关能力：

- 登录状态检测
- 失败通知
- 自动驾驶或审核通知

核心文件：

- `server/services/notification/loginStatus.js`
- `server/services/notification/feishu.js`
- `python/publish/wechat_check_login.py`

## 常见排查

### 自动数字人失败

优先检查：

- `COMFYUI_BASE_URL` 是否正确
- ComfyUI 是否可访问
- `public/presets/audio` 和 `public/presets/image` 是否有可用预设

### 素材驱动卡在步骤 6

说明当前缺少：

- 自动生成得到的内部数字人视频文件 `aiman.mp4`
- 或手动补入的 `aiman.mp4`

`aiman.mp4` 是历史运行协议文件名，保留用于兼容已有任务恢复和测试，不代表产品名称。

### 发布文案生成失败

优先检查：

- 当前 LLM 提供商配置
- 对应 API Key
- 网络状态

### 微信视频号任务失败

优先检查：

- 登录状态是否有效
- 浏览器用户态数据是否可用
- Playwright 依赖是否完整
