# 素材优先方案 - 实施报告

## 项目概述

已完成"素材优先"架构的核心脚本实现，彻底反转原有"脚本驱动"流程，改为"素材驱动"模式。

**实施时间**: 2026-04-02  
**实施状态**: ✅ Phase 1-3 完成，Phase 4 待实施

---

## 一、核心理念

### 旧方案（脚本驱动）
```
先写脚本 → 再写口播 → 再让导演配素材 → 后处理补漏洞
```
**问题**: 数字人喧宾夺主，素材只能"插进去"

### 新方案（素材驱动）
```
先选素材片段（主体）→ 再生成数字人补位（辅助）→ 固定结构编排
```
**优势**: 素材是主体，数字人只负责串联

---

## 二、新增脚本（5个）

### 1. segment_material.py - 素材切片
**职责**: 按字幕时间轴和停顿点切分素材为完整语义段

**输入**:
- `subtitles.json` - 素材字幕
- `result.json` - VLM 分析结果
- `speaker_scene.json` - 人物关系（可选）

**输出**:
- `material_segments.json` - 素材片段列表

**关键功能**:
- 按停顿点（默认 2秒）合并字幕
- 最小片段时长 3秒
- 标记句子完整性
- 标记是否有强原声

### 2. score_material_segments.py - 素材打分
**职责**: 对每个片段评估质量和可用性

**输入**:
- `material_segments.json` - 素材片段

**输出**:
- `material_segments_scored.json` - 已打分片段

**评分维度**:
- 信息密度（0-10分）
- 句子完整性（0-10分）
- 原声质量（0-10分）
- 画面可用性（0-10分）
- 位置适用性（opening/main/closing）

### 3. select_material_segments.py - 素材选用
**职责**: 从高分片段中选出开场、主体、收尾

**输入**:
- `material_segments_scored.json` - 已打分片段

**输出**:
- `selected_segments.json` - 选中的片段

**选择策略**:
- 开场：适合开场的高分片段
- 主体：高优先级 + 适合主体的片段
- 收尾：适合收尾的高分片段
- 目标素材时长：目标总时长的 70-80%

### 4. build_bridge_script.py - 补位文案生成
**职责**: 只生成开场、转场、结尾的短句

**输入**:
- `selected_segments.json` - 选中的片段

**输出**:
- `bridge_script.json` - 补位文案

**文案原则**:
- 短：每句 10-25 字
- 稳：不花哨，不过度解读
- 不抢戏：不重复素材内容

**输出格式**:
```json
{
  "intro": "开场引入（15-20字）",
  "bridges": ["转场1（10-15字）", "转场2"],
  "outro": "结尾收束（15-20字）"
}
```

### 5. compose_timeline.py - 时间线编排
**职责**: 按固定结构编排时间线

**输入**:
- `selected_segments.json` - 选中的片段
- `bridge_script.json` - 补位文案
- `audio.json` - 数字人音频（可选）

**输出**:
- `timeline.json` - 最终时间线

**固定结构**:
```
intro (数字人) → material_1 (素材) → bridge_1 (数字人) 
→ material_2 (素材) → bridge_2 (数字人) → outro (数字人)
```

---

## 三、执行流程对比

### 旧流程（Agent 化）
```
1. run_asr.py
2. video_vlm.py
3. script_planner.py
4. material_planner.py
5. run_director.py
6. director_critic.py
7. post_process_director.py
8. build_video.py
```

### 新流程（素材优先）
```
1. run_asr.py (素材 ASR)
2. video_vlm.py (素材 VLM)
3. segment_material.py ✨
4. score_material_segments.py ✨
5. select_material_segments.py ✨
6. build_bridge_script.py ✨
7. 数字人生成 (只生成补位文案)
8. compose_timeline.py ✨
9. build_video.py
```

---

## 四、核心差异

| 维度 | 旧方案 | 新方案 |
|------|--------|--------|
| **驱动方式** | 脚本驱动 | 素材驱动 |
| **数字人角色** | 主讲 + 素材配合 | 补位串联 |
| **素材角色** | 配合脚本 | 决定主体 |
| **导演职责** | 全局编排 | 不再需要 |
| **时间线结构** | 自由发挥 | 固定模板 |
| **素材占比** | 30-40% | 70-80% |

---

## 五、优势

### 1. 更符合真实目标
- 素材是主体，数字人只是辅助
- 从一开始就是先选素材段

### 2. 更少烂句毁全片
- 数字人只说几句，不再写长篇解说
- 补位文案短小精悍

### 3. 更好控制素材比例
- 目标素材时长 = 总时长 × 70-80%
- 素材占比可预测

### 4. 更容易保留素材原声
- 素材原声不是"插进去"，而是主结构本身
- 高分片段优先保留原声

### 5. 导演不再背锅
- 时间线结构固定，不需要导演自由发挥
- 只需要 build_video.py 做最终合成

---

## 六、文件清单

### 新增文件
```
python/pipeline/
├── segment_material.py              # 素材切片（280 行）
├── score_material_segments.py       # 素材打分（250 行）
├── select_material_segments.py      # 素材选用（200 行）
├── build_bridge_script.py           # 补位文案（220 行）
└── compose_timeline.py              # 时间线编排（180 行）
```

### 弱化/废弃文件
```
python/pipeline/
├── build_outline.py                 # 可废弃
├── generate_narration.py            # 可废弃
├── build_video_script.py            # 可废弃
├── run_director.py                  # 可废弃
└── post_process_director.py         # 简化为平滑处理
```

### 保留文件
```
python/pipeline/
├── run_asr.py                       # 保留
├── video_vlm.py                     # 保留
└── build_video.py                   # 保留
```

---

## 七、下一步（Phase 4）

### 1. 改造后端链路
修改 `server/services/pipeline/handlers.js`，接入新的素材优先链路：

```javascript
// 新链路
await runPipelineScript([runAsrScript, '--input', 'material.mp4']);
await runPipelineScript([videoVlmScript]);
await runPipelineScript([segmentMaterialScript]);
await runPipelineScript([scoreMaterialScript]);
await runPipelineScript([selectMaterialScript]);
await runPipelineScript([buildBridgeScript]);
// 数字人生成（使用 bridge_script.json）
await runPipelineScript([composeTimelineScript]);
await runPipelineScript([buildVideoScript]);
```

### 2. 数字人生成适配
修改数字人生成流程，使其：
- 读取 `bridge_script.json`
- 只生成 intro + bridges + outro
- 输出 `aiman.mp4` 和 `audio.json`

### 3. build_video.py 适配
修改视频合成脚本，使其：
- 读取 `timeline.json` 而非 `director_final.json`
- 按固定结构合成视频

### 4. 联调验证
- 跑通完整链路
- 验证素材占比是否达到 70%
- 验证数字人是否只起补位作用

---

## 八、预期效果

### 质量改善
- ✅ 素材占比提升到 70-80%
- ✅ 数字人只负责串联，不再喧宾夺主
- ✅ 素材原声得到充分保留
- ✅ 时间线结构稳定可预测

### 可维护性
- ✅ 流程清晰，职责明确
- ✅ 不依赖导演自由发挥
- ✅ 易于调试和优化

### 风险
- ⚠️ 需要改造后端链路
- ⚠️ 需要适配数字人生成
- ⚠️ 需要适配视频合成

---

## 九、验证方法

### 语法检查
```bash
cd python/pipeline
python -m py_compile segment_material.py
python -m py_compile score_material_segments.py
python -m py_compile select_material_segments.py
python -m py_compile build_bridge_script.py
python -m py_compile compose_timeline.py
```

### 单元测试
```bash
# 在有测试数据的目录下
python segment_material.py
python score_material_segments.py
python select_material_segments.py
python build_bridge_script.py
python compose_timeline.py
```

---

## 十、总结

✅ **Phase 1-3 完成**: 核心脚本已实现  
⏳ **Phase 4 待实施**: 后端链路改造、数字人生成适配、视频合成适配

**核心理念**: 素材优先，数字人补位，固定结构编排

**预期效果**: 素材占比 70-80%，数字人只负责串联

---

**报告生成时间**: 2026-04-02  
**实施状态**: Phase 1-3 完成，可以开始 Phase 4
