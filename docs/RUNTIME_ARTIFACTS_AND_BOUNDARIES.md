# 运行产物边界

TrendCut Studio 仓库当前同时包含源码、构建产物和运行期产物。阅读或维护时，建议先区分它们的边界。

## 1. 源码

这些目录和文件是当前真正需要维护的工程代码：

- `server.js`
- `frontend/`
- `server/`
- `python/`
  - 其中以 `.py`、`planner/`、`skills/`、`prompt_skills/` 为主
- `config/`
- `docs/`
- `scripts/`
- `mcp-server/`
- `vendor/social-auto-upload/`
- `.env.example`
- `package.json`

## 2. 前端构建产物

- `frontend-dist/`

这是前端打包后的静态文件，不是主要开发入口。

## 3. 运行期项目产物

### `projects/`

素材驱动链路的任务目录。

通常包含：

- 输入素材
- 分析结果
- 脚本和计划文件
- 数字人视频
- 最终成片

其中 `aiman.mp4` 是内部数字人视频文件名，属于运行协议，不代表产品名称。

### `data/`

Node 侧运行时数据和任务数据库。

通常包含：

- `tasks.db`
- 上传缓存
- 队列任务目录
- 临时运行目录

## 4. Python 侧运行缓存

以下内容通常不应被当作“稳定源码”来理解：

- `python/pipeline/*.mp4`
- `python/pipeline/*.json`
- `python/pipeline/subtitle_cards/`
- `python/publish/*.db`
- `python/publish/*.png`
- `python/publish/browser_profiles/`
- `python/publish/publish_jobs.db`
- `python/publish/wechat_channels_user_data/`
- `python/xai/result*.json`
- `python/xai/run_log.txt`
- `python/xai/run_error.log`

这些文件更多是：

- 本地测试样例
- 缓存结果
- 浏览器用户态数据
- 执行日志
- 中间产物

## 5. 文档清理原则

以下类型的文档被视为“历史过程文档”，不再作为主文档保留：

- `*_COMPLETED.md`
- `*_SUMMARY.md`
- `BUGFIX_*.md`
- `FEATURE_*.md`
- `R0_*.md`
- 临时补丁脚本与单次修复说明

## 6. 维护建议

- 看功能时，先从 `frontend/`、`server/`、`python/` 的源码入口开始。
- 看一次任务的执行结果时，再进入 `projects/`。
- 排查运行时问题时，再查看 `data/` 和 Python 侧数据库/日志。
- 不要根据演示产物或旧缓存推断当前实现能力。
