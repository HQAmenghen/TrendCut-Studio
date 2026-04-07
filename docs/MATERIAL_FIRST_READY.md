# 素材优先方案 - 就绪报告

**完成时间**: 2026-04-02  
**状态**: ✅ 全部完成，已就绪

---

## 一、实施总结

### Phase 1-3: 核心脚本实现 ✅
- ✅ segment_material.py - 素材切片（280行）
- ✅ score_material_segments.py - 素材打分（250行）
- ✅ select_material_segments.py - 素材选用（200行）
- ✅ build_bridge_script.py - 补位文案生成（220行）
- ✅ compose_timeline.py - 时间线编排（180行）

### Phase 4: 后端集成 ✅
- ✅ handlers.js - 移除旧 Agent 链路
- ✅ handlers.js - 接入素材优先链路
- ✅ handlers.js - 更新进度提示（9步）
- ✅ build_video.py - 支持 --timeline 参数
- ✅ build_video.py - 兼容新旧格式

### Phase 5: 验证与测试 ✅
- ✅ 语法检查通过（所有 Python 脚本）
- ✅ ESLint 检查通过（handlers.js）
- ✅ 环境验证通过（依赖、配置、工具）
- ✅ 测试检查清单已创建
- ✅ 验证脚本已创建

---

## 二、核心架构

### 数据流
```
material.mp4 + aiman.mp4
  ↓
1. run_asr.py → audio.json, subtitles.json
  ↓
2. video_vlm.py → result.json
  ↓
3. segment_material.py → material_segments.json
  ↓
4. score_material_segments.py → material_segments_scored.json
  ↓
5. select_material_segments.py → selected_segments.json
  ↓
6. build_bridge_script.py → bridge_script.json
  ↓
7. compose_timeline.py → timeline.json
  ↓
8. build_video.py --timeline timeline.json → output_final.mp4
```

### 时间线结构
```json
[
  {"role": "intro", "video_source": "aiman.mp4", "audio_source": "main"},
  {"role": "main_1", "video_source": "material.mp4", "audio_source": "b_roll", "material_cut_start": 10.5, "material_cut_end": 22.2},
  {"role": "bridge_1", "video_source": "aiman.mp4", "audio_source": "main"},
  {"role": "main_2", "video_source": "material.mp4", "audio_source": "b_roll", "material_cut_start": 30.0, "material_cut_end": 45.5},
  {"role": "outro", "video_source": "aiman.mp4", "audio_source": "main"}
]
```

---

## 三、核心理念

### 素材优先
- 素材是主体（70-80%）
- 数字人只负责串联（20-30%）
- 固定结构编排（intro → material → bridge → material → outro）

### 补位文案
- 短：每句 10-25 字
- 稳：不花哨，不过度解读
- 不抢戏：不重复素材内容

### 质量保证
- 素材打分：5个维度（信息密度、句子完整性、原声质量、画面可用性、位置适用性）
- 素材选择：高分优先，目标占比 70-80%
- 原声保留：高分片段保留原声

---

## 四、环境验证结果

### ✅ 核心脚本
- segment_material.py
- score_material_segments.py
- select_material_segments.py
- build_bridge_script.py
- compose_timeline.py
- build_video.py
- run_asr.py
- video_vlm.py

### ✅ 依赖模块
- load_env.py
- llm_client.py
- script_protocol.py

### ✅ Python 依赖
- google.generativeai
- faster_whisper

### ✅ 环境变量
- GEMINI_API_KEY: sk-0K86k...
- QWEN_API_KEY: sk-c4d51...

### ✅ 系统工具
- FFmpeg: 8.1-full_build

### ✅ 后端集成
- handlers.js 包含素材优先链路代码

---

## 五、下一步

### 1. 准备测试素材
- material.mp4: 有清晰原声的采访/演讲视频（30-60秒）
- aiman.mp4: 数字人视频或任意人物视频

### 2. 启动服务
```bash
npm run dev
```

### 3. 测试流程
1. 访问前端界面
2. 上传 material.mp4 到策划界面
3. 填写素材标题和摘要
4. 点击"生成策划"
5. 在运行界面选择策划结果
6. 上传 material.mp4 和 aiman.mp4
7. 点击"开始生成"
8. 观察 9 步流程进度
9. 下载并查看 output_final.mp4

### 4. 验证要点
- [ ] 素材占比 70-80%
- [ ] 数字人只负责串联
- [ ] 补位文案简短（10-25字）
- [ ] 素材原声保留
- [ ] 时间线结构固定
- [ ] 视频流畅无卡顿

### 5. 调试工具
```bash
# 运行环境验证
cd python/pipeline
python verify_material_first.py

# 查看任务目录
cd data/runtime/pipeline_YYYYMMDD_HHMMSS/

# 检查中间文件
ls -lh material_segments.json material_segments_scored.json selected_segments.json bridge_script.json timeline.json

# 查看时间线
cat timeline.json | jq '.'

# 计算素材占比
cat timeline.json | jq '[.[] | select(.video_source == "material.mp4") | (.end_time - .start_time)] | add'
cat timeline.json | jq '[.[] | (.end_time - .start_time)] | add'
```

---

## 六、文档清单

### 实施文档
- ✅ MATERIAL_FIRST_IMPLEMENTATION.md - 总体方案
- ✅ MATERIAL_FIRST_PHASE4_COMPLETED.md - Phase 4 完成报告
- ✅ MATERIAL_FIRST_TEST_CHECKLIST.md - 测试检查清单
- ✅ MATERIAL_FIRST_READY.md - 就绪报告（本文档）

### 验证工具
- ✅ verify_material_first.py - 环境验证脚本

---

## 七、已知限制

### 1. 数字人生成
- 当前使用用户上传的 aiman.mp4
- 未来可接入 ComfyUI 或其他数字人生成服务
- 需要根据 bridge_script.json 自动生成数字人视频

### 2. 音频对齐
- 当前使用估算时长（字数 × 0.3秒）
- 如果 audio.json 存在，使用实际时长
- 未来可优化音频与文案的精确对齐

### 3. 素材选择
- 当前使用 LLM 打分
- 未来可引入更多维度（情感、节奏、视觉冲击力等）
- 未来可支持用户手动调整

---

## 八、总结

✅ **素材优先方案全部完成**

**核心成果**:
- 5个新脚本（1130行代码）
- 后端链路改造完成
- 视频合成适配完成
- 环境验证通过
- 测试文档齐全

**核心理念**:
- 素材优先，数字人补位
- 固定结构编排
- 质量可控，效果可预测

**预期效果**:
- 素材占比 70-80%
- 数字人只负责串联
- 视频质量稳定

**下一步**: 准备测试素材，启动服务，进行端到端测试

---

**报告生成时间**: 2026-04-02  
**状态**: ✅ 已就绪，可以开始测试
