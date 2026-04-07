# 素材优先方案 - 测试检查清单

**测试时间**: 2026-04-02  
**测试目标**: 验证素材优先链路端到端功能

---

## 一、前置准备

### 1. 环境检查
- [x] Python 脚本语法检查通过（5个新脚本）
- [x] build_video.py 语法检查通过
- [x] handlers.js ESLint 检查通过（已修复 warnings）
- [ ] LLM 配置正确（Gemini 或 Qwen）
- [ ] FFmpeg 可用
- [ ] Whisper 模型可用

### 2. 测试素材准备
- [ ] 准备测试用 material.mp4（建议：有清晰原声的采访/演讲视频，30-60秒）
- [ ] 准备测试用 aiman.mp4（数字人视频，或任意人物视频）
- [ ] 确保 material.mp4 有音轨和字幕内容
- [ ] 确保 aiman.mp4 有音轨

---

## 二、功能测试

### Phase 1: Plan Pipeline（策划阶段）

**测试步骤**:
1. 上传 material.mp4 到策划界面
2. 填写素材标题和摘要
3. 点击"生成策划"

**预期输出**:
- [ ] ASR 识别成功，生成 subtitles.json
- [ ] VLM 分析成功，生成 result.json
- [ ] 内容大纲生成成功，生成 content_outline.json
- [ ] 口播文案生成成功，生成 narration_plan.json
- [ ] 视频脚本生成成功，生成 video_script.json

**检查点**:
```bash
# 进入任务目录
cd data/runtime/plan_YYYYMMDD_HHMMSS/

# 检查文件是否存在
ls -lh subtitles.json result.json content_outline.json narration_plan.json video_script.json
```

---

### Phase 2: Run Pipeline（素材优先链路）

**测试步骤**:
1. 在运行界面选择刚才的策划结果
2. 上传 material.mp4 和 aiman.mp4
3. 点击"开始生成"

**预期流程**:
```
1/9: 正在 ASR 识别与翻译...
2/9: 正在 VLM 分析画面...
3/9: 正在切分素材片段...
4/9: 正在评估素材质量...
5/9: 正在选择素材片段...
6/9: 正在生成补位文案...
7/9: 正在编排时间线...
8/9: FFmpeg 正在合成视频...
9/9: 生成动态竖屏...（可选）
```

**预期输出**:
- [ ] audio.json（数字人 ASR）
- [ ] material_segments.json（素材切片）
- [ ] material_segments_scored.json（素材打分）
- [ ] selected_segments.json（选中片段）
- [ ] bridge_script.json（补位文案）
- [ ] timeline.json（时间线）
- [ ] output_final.mp4（最终视频）

**检查点**:
```bash
# 进入任务目录
cd data/runtime/pipeline_YYYYMMDD_HHMMSS/

# 检查中间文件
ls -lh material_segments.json material_segments_scored.json selected_segments.json bridge_script.json timeline.json

# 检查最终视频
ls -lh output_final.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 output_final.mp4
```

---

## 三、质量验证

### 1. 素材占比验证

**检查方法**:
```bash
# 读取 timeline.json
cat timeline.json | jq '.'

# 计算素材占比
cat timeline.json | jq '[.[] | select(.video_source == "material.mp4") | (.end_time - .start_time)] | add'
cat timeline.json | jq '[.[] | (.end_time - .start_time)] | add'
```

**预期结果**:
- [ ] 素材总时长 / 视频总时长 >= 70%
- [ ] 素材总时长 / 视频总时长 <= 80%

### 2. 数字人补位验证

**检查方法**:
```bash
# 读取 bridge_script.json
cat bridge_script.json | jq '.'

# 检查补位文案长度
cat bridge_script.json | jq '.intro | length'
cat bridge_script.json | jq '.bridges[] | length'
cat bridge_script.json | jq '.outro | length'
```

**预期结果**:
- [ ] intro 长度 15-20 字
- [ ] 每个 bridge 长度 10-15 字
- [ ] outro 长度 15-20 字
- [ ] 补位文案不重复素材内容
- [ ] 补位文案简短、稳定、不花哨

### 3. 时间线结构验证

**检查方法**:
```bash
# 检查时间线结构
cat timeline.json | jq '[.[] | .role]'
```

**预期结果**:
- [ ] 固定结构：intro → material → bridge → material → outro
- [ ] 每个片段的 start_time 和 end_time 连续
- [ ] 没有时间重叠或间隙

### 4. 素材原声保留验证

**检查方法**:
```bash
# 检查素材片段的音频源
cat timeline.json | jq '[.[] | select(.video_source == "material.mp4") | {role, audio_source, keep_source_audio: (.audio_source == "b_roll")}]'
```

**预期结果**:
- [ ] 高分素材片段使用 audio_source: "b_roll"（保留原声）
- [ ] 低分素材片段使用 audio_source: "main"（使用数字人音轨）

### 5. 视频质量验证

**检查方法**:
1. 播放 output_final.mp4
2. 检查画面是否流畅
3. 检查音频是否清晰
4. 检查字幕是否正确

**预期结果**:
- [ ] 画面流畅，无卡顿
- [ ] 音频清晰，无杂音
- [ ] 字幕与音频同步
- [ ] 素材片段和数字人片段切换自然

---

## 四、边界情况测试

### 1. 素材无音轨
**测试**: 上传无音轨的 material.mp4  
**预期**: 使用 --allow-no-audio 参数，生成空字幕

### 2. 素材时长过短
**测试**: 上传 10 秒以下的 material.mp4  
**预期**: 能够正常处理，但可能选不到足够的素材片段

### 3. 素材时长过长
**测试**: 上传 5 分钟以上的 material.mp4  
**预期**: 能够正常处理，选择高分片段

### 4. 素材无字幕
**测试**: 上传纯音乐或环境音的 material.mp4  
**预期**: ASR 识别为空，后续流程可能失败（需要处理）

---

## 五、性能测试

### 1. 处理时间
**测试**: 记录每个阶段的耗时

**预期**:
- ASR: 视频时长 × 0.5 ~ 1.0
- VLM: 30 ~ 60 秒
- 素材切片: < 5 秒
- 素材打分: 30 ~ 60 秒（LLM 调用）
- 素材选用: < 5 秒
- 补位文案: 10 ~ 30 秒（LLM 调用）
- 时间线编排: < 5 秒
- 视频合成: 视频时长 × 1.0 ~ 2.0

### 2. 资源占用
**测试**: 监控 CPU、内存、GPU 使用率

**预期**:
- CPU: < 80%
- 内存: < 4GB
- GPU: < 80%（如果使用 GPU 加速）

---

## 六、错误处理测试

### 1. LLM 调用失败
**测试**: 临时断网或配置错误的 API Key  
**预期**: 脚本报错，返回明确的错误信息

### 2. FFmpeg 失败
**测试**: 提供损坏的视频文件  
**预期**: 脚本报错，返回明确的错误信息

### 3. 文件缺失
**测试**: 手动删除中间文件  
**预期**: 脚本报错，返回明确的错误信息

---

## 七、回归测试

### 1. 旧链路兼容性
**测试**: 确认旧的 director_final.json 模式仍然可用  
**方法**: 不传 --timeline 参数给 build_video.py

**预期**:
- [ ] build_video.py 能够读取 director_final.json
- [ ] 视频合成成功

---

## 八、测试结果记录

### 测试环境
- 操作系统: Windows 10 Pro 10.0.19045
- Python 版本: ___
- Node.js 版本: ___
- FFmpeg 版本: ___
- LLM 提供商: Gemini / Qwen

### 测试结果
- [ ] Phase 1 通过
- [ ] Phase 2 通过
- [ ] 素材占比验证通过
- [ ] 数字人补位验证通过
- [ ] 时间线结构验证通过
- [ ] 素材原声保留验证通过
- [ ] 视频质量验证通过
- [ ] 边界情况测试通过
- [ ] 性能测试通过
- [ ] 错误处理测试通过
- [ ] 回归测试通过

### 发现的问题
1. 
2. 
3. 

### 待优化项
1. 
2. 
3. 

---

**测试完成时间**: ___  
**测试结论**: ___
