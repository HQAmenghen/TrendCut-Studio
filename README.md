# Comfy Panel Demo

一个用于数字人渲染、AI 自动混剪、竖屏后期合成的本地控制面板。

## 功能概览

- 数字人口播生成
- AI 导演双轨混剪
- 竖屏后期自动包装
- ASR 自动打轴
- 中英双语字幕卡
- 自动热点标题生成

## 目录说明

- `server.js`：Node.js 后端入口
- `public/index.html`：前端控制台
- `pipeline_scripts/`：Python 脚本、字幕、标题、后期合成逻辑
- `workflow_api.json`：ComfyUI 工作流模板

## 本地运行

### 1. 安装依赖

先安装：

- Node.js 18 或 20
- Python 3.10+
- FFmpeg

安装 Node 依赖：

```bash
npm install
```

安装 Python 依赖：

```bash
pip install -r pipeline_scripts/requirements.txt
```

### 2. 配置模型 Key

推荐使用环境变量：

Windows PowerShell:

```powershell
$env:GEMINI_API_KEY="你的Key"
```

或：

```powershell
$env:GOOGLE_API_KEY="你的Key"
```

### 3. 启动服务

```bash
npm start
```

服务默认监听：

- 本机地址：`http://localhost:3001`
- 局域网地址：`http://你的局域网IP:3001`

现在服务监听的是 `0.0.0.0`，所以同一局域网下的其他电脑也可以访问，只要：

- 你的电脑和对方在同一局域网
- 系统防火墙放行 `3001` 端口

### 4. 查看本机局域网 IP

Windows PowerShell:

```powershell
ipconfig
```

常见地址类似：

```text
192.168.1.23
```

那么局域网其他电脑可访问：

```text
http://192.168.1.23:3001
```

## Docker 运行

### 1. 构建并启动

```bash
docker compose up --build
```

### 2. 传入 Key

可以先设置环境变量：

```bash
export GEMINI_API_KEY=你的Key
docker compose up --build
```

Windows PowerShell:

```powershell
$env:GEMINI_API_KEY="你的Key"
docker compose up --build
```

### 3. 访问地址

- 本机：`http://localhost:3001`
- 局域网：`http://你的局域网IP:3001`

## 常见问题

### 1. 局域网访问不到

检查：

- 服务是否已经启动
- 本机防火墙是否允许 `3001`
- 访问的 IP 是否是当前机器正确的局域网地址

### 2. 竖屏标题或字幕不显示

重点检查这些文件是否生成：

- `pipeline_scripts/content.json`
- `pipeline_scripts/subtitles.json`

### 3. 字幕识别错字

术语硬纠错词库在：

- `pipeline_scripts/glossary.json`

你可以继续往里面追加：

```json
"错词": "正确词"
```

### 4. Docker 能启动但字体不对

当前镜像已内置 Linux 字体，并兼容 Windows / Linux 字体路径。
如果你自定义了字体逻辑，检查：

- `pipeline_scripts/make_vertical_video.py`

## 运行产物

常见运行结果文件：

- `pipeline_scripts/content.json`
- `pipeline_scripts/subtitles.json`
- `pipeline_scripts/audio.json`
- `public/output_final.mp4`
- `public/standalone_output_vertical.mp4`
