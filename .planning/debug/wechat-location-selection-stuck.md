---
status: investigating
trigger: "用户观察到微信视频号自动发布失败的一个原因是位置选择有时会卡住，导致无法进行下一步；需要做成功率改进。"
created: "2026-05-12"
updated: "2026-05-12"
---

# Debug Session: wechat-location-selection-stuck

## Symptoms

- Expected behavior: 微信视频号 RPA 设置位置失败时应快速降级跳过，并继续原创声明和发表流程。
- Actual behavior: 位置选择有时卡住，导致后续步骤无法继续。
- Error messages: 用户未提供具体错误；历史日志显示地区选择会多轮尝试，成功任务也可能耗时在“地区查找”上。
- Timeline: 2026-05-12 当前自动发布观察。
- Reproduction: 阅读 `python/publish/wechat_channels_rpa.py` 的地区选择实现，补强超时与降级路径。

## Current Focus

- hypothesis: 视频号真实“位置”组件是 `.post-position-wrap -> .position-display -> .location-filter-wrap -> .location-item`，当前位置和候选列表同在一个外层容器里；原逻辑容易把候选项文本误判为已选值，也缺少真实 DOM 针对性选择器和成功验证。
- test: 用真实测试账号运行 `wechat_region_probe.py` 采集位置 DOM 和点击前后状态；新增本地 Playwright 压测覆盖真实 DOM 的未展开/已展开/已选中状态；运行 Python 语法检查和单元测试。
- expecting: RPA 能在真实页面把当前位置从城市名改成“不显示位置”，并在本地多轮压测中稳定通过。
- next_action: monitor next real autopublish run logs
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-05-12"
  source: `python/publish/wechat_channels_rpa.py`
  finding: "`select_no_region` 原本最多执行 6 轮，每轮会跨主页面和 iframe 查找/点击多个地区触发器与选项，单个候选可等待 2-2.5 秒；没有全局时间预算，也没有统一关闭弹层/恢复焦点的收尾。"
- timestamp: "2026-05-12"
  source: user observation
  finding: "微信位置选择有时会卡住，表现为后续原创声明/发表步骤没有继续。"
- timestamp: "2026-05-12"
  source: `data/logs/wechat_region_probe_20260512-101137.jsonl`
  finding: "真实视频号页面位置组件位于 `frame[1] https://channels.weixin.qq.com/micro/content/post/create`；选择前 `.position-display-wrap` 文本为“成都市”，选择后文本变为“不显示位置”。"
- timestamp: "2026-05-12"
  source: `python/tests/test_wechat_region_selection_stress.py`
  finding: "新增压测覆盖 `wechat_position_display`、`wechat_position_visible_option`、`wechat_position_selected`，模拟真实 `.post-position-wrap/.location-filter-wrap/.location-item` 结构。"

## Eliminated

- hypothesis: 位置设置必须成功才能发布。
  evidence: 现有代码在找不到地区选项时已有“跳过地区设置”路径，说明该步骤可降级；问题是降级不够有界且弹层可能残留。

## Resolution

- root_cause: "真实页面的位置控件把当前值、隐藏选项和附近地点列表放在同一个 `post-position-wrap` 容器中；旧逻辑用通用文本查找，可能把下拉候选项“不显示位置/不展示地区”误判为当前已选，或在打开下拉和点击选项两个阶段混用选择器，导致偶发跳过/残留下拉/后续步骤受影响。"
- fix: "将地区选择改为真实 DOM 驱动的 bounded best-effort：新增总时间预算、短超时和弹层收尾；当前值检测只认具体显示节点/选中态，排除候选列表文本；优先点击已展开的 `.location-item`，再打开 `.position-display`，再点击选项；点击后验证当前值真的变为“不显示位置/不展示地区”。新增真实页面探针脚本和多变体压测。"
- verification: "`python python\\tests\\test_wechat_region_selection_stress.py --runs 45 --seed 20260512` 45/45 通过；`python -m unittest python.tests.test_wechat_channels_rpa python.tests.test_wechat_region_selection_stress` 通过；真实探针日志 `data/logs/wechat_region_probe_20260512-101137.jsonl` 显示 `.position-display-wrap` 从“成都市”变为“不显示位置”；`git diff --check` 仅提示 CRLF/LF 转换警告。"
