# 素材优先方案 - Phase 4 完成报告

**实施时间**: 2026-04-02  
**实施状态**: ✅ Phase 4 完成

---

## 一、Phase 4 实施内容

### 1. 后端链路改造 (handlers.js)

**修改文件**: `server/services/pipeline/handlers.js`

**核心变更**:
- 移除旧的 Agent 链路（script_planner, material_planner, director_critic, run_director, post_process_director）
- 接入新的素材优先链路（5个新脚本）
- 更新进度提示为 9 步流程
- 修改视频合成调用，使用 timeline.json 替代 director_final.json

**新流程**:
```javascript
// Phase 1: ASR + VLM (复用 plan 阶段结果)
1/9: ASR 识别与翻译
2/9: VLM 分析画面

// Phase 2: 素材优先链路
3/9: 正在切分素材片段 (segment_material.py)
4/9: 正在评估素材质量 (score_material_segments.py)
5/9: 正在选择素材片段 (select_material_segments.py)
6/9: 正在生成补位文案 (build_bridge_script.py)

// Phase 3: 数字人生成（当前使用上传的 aiman.mp4）
补位文案已生成

// Phase 4: 时间线编排
7/9: 正在编排时间线 (compose_timeline.py)

// Phase 5: 视频合成
8/9: FFmpeg 正在合成视频 (build_video.py --timeline timeline.json)
9/9: 生成动态竖屏 (可选)
```

### 2. 视频合成脚本适配 (build_video.py)

**修改文件**: `python/pipeline/build_video.py`

**核心变更**:
- 新增 `--timeline` 参数，支持读取 timeline.json
- 兼容旧的 director_final.json 格式
- 支持 timeline.json 的字段名（material_cut_start/material_cut_end）
- 支持 director_final.json 的字段名（cut_start）

**参数说明**:
```bash
python build_video.py --timeline timeline.json  # 素材优先模式
python build_video.py                           # 旧模式（director_final.json）
python build_video.py --no-subs                 # 禁用字幕
```

### 3. 数字人生成适配

**当前实现**: 直接使用用户上传的 aiman.mp4

**说明**:
- 补位文案已生成到 bridge_script.json
- 当前假设 aiman.mp4 已包含对应音频
- 未来可接入 ComfyUI 或其他数字人生成服务，根据 bridge_script.json 生成数字人视频

---

## 二、关键代码变更

### handlers.js 关键修改

**1. 移除旧 Agent 链路**:
```javascript
// 已移除以下调用:
// - scriptPlannerScript
// - materialPlannerScript  
// - directorCriticScript
// - runDirectorScript
// - postProcessDirectorScript
```

**2. 新增素材优先链路**:
```javascript
await runPipelineScript([segmentMaterialScript], { sse, progress: 35, msg: '3/9: 正在切分素材片段...', ...});
await runPipelineScript([scoreMaterialScript], { sse, progress: 45, msg: '4/9: 正在评估素材质量...', ...});
await runPipelineScript([selectMaterialScript], { sse, progress: 55, msg: '5/9: 正在选择素材片段...', ...});
await runPipelineScript([buildBridgeScript], { sse, progress: 65, msg: '6/9: 正在生成补位文案...', ...});
await runPipelineScript([composeTimelineScript], { sse, progress: 75, msg: '7/9: 正在编排时间线...', ...});
```

**3. 修改视频合成调用**:
```javascript
// 旧版
await runPipelineScript([buildVideoScript], { sse, progress: 85, msg: '8/8: FFmpeg 正在合成视频...', ...});

// 新版
const buildArgs = [buildVideoScript, '--timeline', path.join(taskDir, 'timeline.json')];
await runPipelineScript(buildArgs, { sse, progress: 85, msg: '8/9: FFmpeg 正在合成视频...', ...});
```

**4. 修改返回数据**:
```javascript
// 旧版
res.json({
  success: true,
  videoUrl: `${finalUrl}?t=${Date.now()}`,
  directorPlan: Array.isArray(directorPlan) ? directorPlan : []
});

// 新版
res.json({
  success: true,
  videoUrl: `${finalUrl}?t=${Date.now()}`,
  timeline: Array.isArray(timeline) ? timeline : []
});
```

### build_video.py 关键修改

**1. 新增参数**:
```python
parser.add_argument("--timeline", type=str, help="Path to timeline.json (material-first mode)")
```

**2. 动态读取文件**:
```python
plan_file = args.timeline if args.timeline else 'director_final.json'
print(f"   正在读取: {plan_file}")
with open(plan_file, 'r', encoding='utf-8') as f:
    director = json.load(f)
```

**3. 兼容字段名**:
```python
# 支持 timeline.json 的 material_cut_start 和 director_final.json 的 cut_start
v_start = scene.get("material_cut_start") or scene.get("cut_start")
a_start = scene.get("material_cut_start") or scene.get("cut_start")
```

---

## 三、数据流对比

### 旧流程（Agent 模式）
```
material.mp4 + aiman.mp4
  ↓ run_asr.py → audio.json, subtitles.json
  ↓ video_vlm.py → result.json
  ↓ script_planner.py → script_plan.json
  ↓ material_planner.py → material_plan.json
  ↓ run_director.py → director_draft.json
  ↓ director_critic.py → director_review.json
  ↓ post_process_director.py → director_final.json
  ↓ build_video.py → output_final.mp4
```

### 新流程（素材优先）
```
material.mp4 + aiman.mp4
  ↓ run_asr.py → audio.json, subtitles.json
  ↓ video_vlm.py → result.json
  ↓ segment_material.py → material_segments.json
  ↓ score_material_segments.py → material_segments_scored.json
  ↓ select_material_segments.py → selected_segments.json
  ↓ build_bridge_script.py → bridge_script.json
  ↓ compose_timeline.py → timeline.json
  ↓ build_video.py --timeline timeline.json → output_final.mp4
```

---

## 四、timeline.json 格式

```json
[
  {
    "start_time": 0.0,
    "end_time": 3.5,
    "video_source": "aiman.mp4",
    "audio_source": "main",
    "subtitle_text": "这段讨论的核心，是加密市场监管法案的推进。",
    "role": "intro"
  },
  {
    "start_time": 3.5,
    "end_time": 15.2,
    "video_source": "material.mp4",
    "audio_source": "b_roll",
    "subtitle_text": "素材原声内容...",
    "role": "main_1",
    "material_cut_start": 10.5,
    "material_cut_end": 22.2
  },
  {
    "start_time": 15.2,
    "end_time": 18.0,
    "video_source": "aiman.mp4",
    "audio_source": "main",
    "subtitle_text": "这里其实已经把监管方向说得很明确了。",
    "role": "bridge_1"
  },
  {
    "start_time": 18.0,
    "end_time": 21.5,
    "video_source": "aiman.mp4",
    "audio_source": "main",
    "subtitle_text": "真正值得关注的是，这会不会很快落地。",
    "role": "outro"
  }
]
```

**关键字段**:
- `video_source`: "aiman.mp4" 或 "material.mp4"
- `audio_source`: "main" (数字人音轨) 或 "b_roll" (素材原声)
- `role`: "intro", "main_1", "main_2", "bridge_1", "closing", "outro"
- `material_cut_start/material_cut_end`: 素材片段的切入切出点（仅素材片段有）

---

## 五、验证清单

### ✅ 已完成
- [x] handlers.js 移除旧 Agent 链路
- [x] handlers.js 接入素材优先链路
- [x] handlers.js 更新进度提示（9步）
- [x] handlers.js 修改视频合成调用
- [x] handlers.js 修改返回数据结构
- [x] build_video.py 支持 --timeline 参数
- [x] build_video.py 兼容 timeline.json 字段名
- [x] build_video.py 兼容 director_final.json 字段名

### ⏳ 待验证
- [ ] 完整链路端到端测试
- [ ] 验证素材占比是否达到 70-80%
- [ ] 验证数字人只起补位作用
- [ ] 验证素材原声保留效果
- [ ] 验证时间线结构稳定性

### 🔮 未来优化
- [ ] 接入 ComfyUI 数字人生成服务
- [ ] 根据 bridge_script.json 自动生成数字人视频
- [ ] 支持数字人音频与补位文案的时间对齐
- [ ] 优化素材选择算法（更智能的打分）
- [ ] 支持用户手动调整素材片段

---

## 六、总结

✅ **Phase 4 完成**: 后端链路改造、视频合成适配  
✅ **Phase 1-4 全部完成**: 素材优先方案核心实现完毕

**核心理念**: 素材优先，数字人补位，固定结构编排

**预期效果**: 素材占比 70-80%，数字人只负责串联

**下一步**: 联调验证，测试完整链路

---

**报告生成时间**: 2026-04-02  
**实施状态**: Phase 4 完成，可以开始联调验证
