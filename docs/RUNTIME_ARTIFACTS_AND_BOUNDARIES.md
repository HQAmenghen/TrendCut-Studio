# 运行产物与源码边界说明

这份文档用于回答一个常见问题：

**当前仓库里哪些是工程文件，哪些是运行期产生的文件？**

## 1. 为什么要区分

这个项目不是纯前后端源码仓库，它同时承载了：

- Node 后端源码
- Vue 前端源码
- Python 业务脚本
- 构建产物
- 任务缓存
- 视频输出
- 运行日志
- 数据库与账号状态

如果不区分这些边界，就很容易出现：

- 误把运行缓存当源码
- 误统计工程体积
- 错误提交大文件
- 调试时找错目录

## 2. 工程源码

下面这些目录或文件应被视为工程源码或工程文档：

- `server/`
- `frontend/`
- `python/*.py`
- `docs/`
- `scripts/`
- `config/`
- `package.json`
- `requirements.txt`
- `Dockerfile`
- `.env.example`

## 3. 构建产物

### 3.1 `frontend-dist/`

这是前端构建后的静态产物，不是前端源码。

如果前端页面有修改，应以 `frontend/` 为准，而不是直接修改 `frontend-dist/`。

## 4. 运行时数据

### 4.1 `data/`

`data/` 是最核心的运行目录，常见内容包括：

- `data/logs/`
- `data/uploads/runtime_jobs/`
- `data/uploads/xai_vertical_queue/`

这些目录属于任务运行中间产物和日志目录。

### 4.2 `public/`

`public/` 当前是混合目录，既有静态资源，也有最终输出产物。

典型运行产物：

- `public/output_final.mp4`
- `public/standalone_output_vertical.mp4`
- `public/xai_vertical_queue/...`

因此不要把 `public/` 整体都理解成源码资源目录。

## 5. Python 目录中的非源码文件

虽然 `python/` 主要存脚本，但当前也混入了大量运行文件。

### 5.1 `python/pipeline/`

除了脚本，还可能包含：

- `aiman.mp4`
- `material.mp4`
- `output_final.mp4`
- `standalone_input.mp4`
- `standalone_output_vertical.mp4`
- `audio.json`
- `director.json`
- `result.json`
- `subtitles.json`
- `subtitles.srt`
- `subtitle_cards/`

这些大多属于运行输入、调试输出和中间产物。

### 5.2 `python/publish/`

除了脚本，还可能包含：

- `publish_jobs.db*`
- `publish_jobs.json.bak`
- `temp_qrcode.png`
- `wechat_channels_tasks/`
- `data/logs/`

这些属于发布任务状态、临时二维码和运行日志。

### 5.3 `python/xai/`

除了脚本，还可能包含：

- `result.json`
- `result.partial.json`
- `run_log.txt`
- `run_error.log`
- `xai_top10_cache.json`

这些属于榜单运行结果与缓存。

## 6. 统计工程体积时的推荐排除项

如果要计算“工程本身有多大”，建议至少排除：

- `node_modules/`
- `.git/`
- `frontend-dist/`
- `data/`
- `public/xai_vertical_queue/`
- `python/publish/wechat_channels_user_data/`
- `python/publish/browser_profiles/`
- `python/publish/wechat_channels_tasks/`
- `python/pipeline/*.mp4`
- `python/pipeline/subtitle_cards/`
- `python/xai/result*.json`
- `python/xai/run_*.log`

## 7. 当前推荐的维护原则

- 修改功能时，以 `server/`、`frontend/`、`python/*.py` 为准。
- 排障时，优先查看 `data/`、`public/`、`python/*` 里的运行结果。
- 做代码统计、工程评估或归档时，要先剔除运行产物。

## 8. 后续工程化建议

如果后续继续治理，建议逐步把运行产物继续从源码目录中剥离：

- `python/pipeline/` 中的媒体和中间 JSON
- `python/publish/` 中的数据库和任务文件
- `python/xai/` 中的结果缓存
- `public/` 中的批量输出目录

这样能明显降低仓库噪音，也更利于协作和备份。
