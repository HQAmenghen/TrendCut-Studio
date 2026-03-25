# Smoke Test Checklist

## 1. 目标

这份清单用于在重构、目录调整、脚本升级、环境迁移之后，快速确认项目四条主链路是否仍然“活着”。

Smoke test 不追求覆盖所有细节，只回答一个问题：

“系统关键路径是否仍然能跑通到最小可用状态？”

---

## 2. 执行原则

- 每次做了路径调整、模块拆分、依赖升级后执行一次
- 每次上线新机器或新环境后执行一次
- 每个测试只验证最小可用输入
- 失败时优先记录“失败阶段”和“接口/脚本名”，不要直接跳进大范围排查

---

## 3. 通用前置条件

执行前先确认：

- 服务可以启动
- `.env` 已存在并加载
- `public/presets/audio/`、`public/presets/image/` 至少各有一个可用预设
- `config/workflow_api.json` 存在
- `python/pipeline/requirements.txt` 对应依赖已经安装
- FFmpeg、Python、Node 可以在当前环境运行

---

## 4. Smoke Test: Pipeline

### 4.1 目标

确认数字人口播和 AI 混剪主链路仍然可用。

### 4.2 最小检查项

1. `GET /api/presets`
   - 预期：返回 `audio` 和 `image` 数组

2. `GET /api/workflow-config`
   - 预期：返回 `success: true`

3. `POST /api/generate`
   - 输入：最小文案 + 一个音频预设 + 一个图片预设
   - 预期：
     - 接口进入执行
     - SSE 有状态回传
     - 没有立刻报路径错误或配置错误

4. `POST /api/run-pipeline`
   - 输入：最小 `aiman.mp4` + `material.mp4`
   - 预期：
     - 创建 runtime 任务目录
     - 能顺序进入 `run_asr.py`、`video_vlm.py`、`run_director.py`、`build_video.py`
     - 最终产出 `public/output_final.mp4`

### 4.3 失败重点关注

- ComfyUI 地址不可达
- `workflow_api.json` 结构不匹配
- Python 脚本路径错误
- 输出文件没生成

---

## 5. Smoke Test: Standalone

### 5.1 目标

确认单条竖屏生成链路仍然可用。

### 5.2 最小检查项

1. `POST /api/generate-vertical-standalone`
   - 输入：一个最小测试视频
   - 预期：
     - 能创建任务目录
     - 能执行 ASR 或 SRT 转换分支
     - 能执行 `make_vertical_video.py`
     - 最终产出 `public/standalone_output_vertical.mp4`

2. 不填写标题再执行一次
   - 预期：
     - 标题生成必须走大模型
     - 如果失败，应明确返回标题生成失败
     - 不允许出现“字幕前几句被当作标题”的静默兜底

### 5.3 失败重点关注

- 上传文件未落到任务目录
- `run_asr.py` 失败
- `convert_srt_to_json.py` 失败
- `generate_title.py` 失败
- `make_vertical_video.py` 失败

---

## 6. Smoke Test: XAI

### 6.1 目标

确认热点榜单发现链路仍然可用。

### 6.2 最小检查项

1. `GET /api/xai-top10/status`
   - 预期：返回状态结构

2. `GET /api/xai-top10/config`
   - 预期：返回账号池配置

3. `POST /api/xai-top10/config`
   - 输入：一个最小账号列表
   - 预期：成功写回配置

4. `POST /api/xai-top10/run`
   - 输入：最小 `clientId`
   - 预期：
     - Python 脚本成功启动
     - 状态流更新
     - 结果文件成功写出，或至少不在启动阶段就失败

### 6.3 失败重点关注

- `XAI_API_KEY` 缺失
- `python/xai/run_xai_top10.py` 路径错误
- 结果文件读写失败
- 外部接口限流

---

## 7. Smoke Test: Publish

### 7.1 目标

确认素材聚合、发布任务创建和微信视频号执行入口可用。

### 7.2 最小检查项

1. `GET /api/publish/assets`
   - 预期：能读取至少一类素材

2. `GET /api/publish/config`
   - 预期：返回平台配置

3. `POST /api/publish/jobs`
   - 输入：选择一个已存在素材 + 启用微信视频号
   - 预期：成功创建任务

4. `POST /api/publish/jobs/:jobId/wechat-channels`
   - 预期：
     - 至少通过前置校验
     - 若失败，应能明确告诉你是配置缺失、账号无效还是 RPA 启动失败

### 7.3 失败重点关注

- 素材池为空
- 微信账号配置不完整
- Playwright / Chromium 不可用
- `wechat_channels_rpa.py` 不存在

---

## 8. 建议执行频率

- 代码结构调整后：必须执行
- 依赖升级后：建议执行
- 新环境部署后：必须执行
- 平时纯 UI 微调后：可选执行

---

## 9. 测试结果记录建议

每次执行至少记录：

- 日期
- 提交版本或改动说明
- 通过的模块
- 失败的模块
- 失败阶段
- 第一条关键报错
