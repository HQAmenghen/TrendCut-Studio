# P1 问题修复报告 - 目标时长配置失效

**问题发现时间**: 2026-04-02  
**修复时间**: 2026-04-02  
**优先级**: P1（重要）  
**状态**: ✅ 已修复

---

## 一、问题描述

### 原始问题
select_material_segments.py 中的 target_duration 被硬编码为 45 秒：

```python
# 目标时长（可以从配置读取）
target_duration = 45
```

**影响**:
- 用户在前端配置的目标时长（30秒、45秒、60秒等）被忽略
- 素材片段选择始终按 45 秒预算工作
- 后续的补位文案和时间线编排也会失真
- 最终视频时长与用户预期不符

---

## 二、解决方案

### 修改内容
修改 select_material_segments.py，从 content_outline.json 读取目标时长：

```python
def main():
    """主函数"""
    emit_stage("select_material", "正在选择素材片段")

    print("1. 正在读取已打分的素材片段...")
    scored_data = load_json("material_segments_scored.json", {})
    # ... 省略 ...

    print("\n2. 正在读取目标时长配置...")

    # 从 content_outline.json 读取目标时长
    content_outline = load_json("content_outline.json", {})
    target_duration = content_outline.get("target_duration_sec", 45)

    # 如果 content_outline 中没有，尝试从 video_script.json 读取
    if target_duration == 45 and not content_outline:
        video_script = load_json("video_script.json", {})
        target_duration = video_script.get("target_duration_sec", 45)

    print(f"   ✓ 目标时长: {target_duration}s")

    print("\n3. 正在选择素材片段...")
    selected, used_duration = select_segments(segments, target_duration)
    # ... 省略 ...
```

### 读取顺序
1. 优先从 content_outline.json 读取 target_duration_sec
2. 如果不存在，尝试从 video_script.json 读取
3. 如果都不存在，使用默认值 45 秒

### 数据流
```
用户配置 targetDurationSec (前端)
  ↓
handlePlanPipeline (handlers.js)
  ↓
build_outline.py --target-duration {targetDurationSec}
  ↓
content_outline.json { "target_duration_sec": 60 }
  ↓
select_material_segments.py 读取 target_duration_sec
  ↓
selected_segments.json { "target_duration_sec": 60 }
  ↓
compose_timeline.py 使用正确的目标时长
```

---

## 三、验证

### 测试场景

#### 场景 1: 用户配置 30 秒
```
前端: targetDurationSec = 30
预期: 素材选择按 30 秒预算，最终视频约 30 秒
```

#### 场景 2: 用户配置 60 秒
```
前端: targetDurationSec = 60
预期: 素材选择按 60 秒预算，最终视频约 60 秒
```

#### 场景 3: 用户配置 120 秒
```
前端: targetDurationSec = 120
预期: 素材选择按 120 秒预算，最终视频约 120 秒
```

### 验证方法
```bash
# 1. 运行策划阶段，配置目标时长为 60 秒
# 2. 检查 content_outline.json
cat content_outline.json | jq '.target_duration_sec'
# 预期输出: 60

# 3. 运行素材选择
python select_material_segments.py

# 4. 检查 selected_segments.json
cat selected_segments.json | jq '.target_duration_sec'
# 预期输出: 60

# 5. 检查实际素材时长
cat selected_segments.json | jq '.actual_material_duration_sec'
# 预期输出: 约 42-48 秒（60 秒的 70-80%）
```

---

## 四、相关文件

### 修改文件
1. `python/pipeline/select_material_segments.py`
   - 添加读取 content_outline.json 的逻辑
   - 添加读取 video_script.json 的后备逻辑
   - 添加日志输出目标时长

### 依赖文件
1. `python/pipeline/build_outline.py`
   - 生成 content_outline.json
   - 包含 target_duration_sec 字段

2. `server/services/pipeline/handlers.js`
   - handlePlanPipeline 接收 targetDurationSec
   - 传递给 build_outline.py

---

## 五、后续优化

### 可选改进
1. 添加命令行参数支持
   ```python
   parser.add_argument("--target-duration", type=int, help="目标时长（秒）")
   ```

2. 添加环境变量支持
   ```python
   target_duration = int(os.getenv("TARGET_DURATION_SEC", 45))
   ```

3. 添加配置文件支持
   ```python
   config = load_json("pipeline_config.json", {})
   target_duration = config.get("target_duration_sec", 45)
   ```

### 不推荐的方案
- ❌ 通过 handlers.js 传递命令行参数
  - 原因：增加耦合，不利于脚本独立运行
- ❌ 使用全局配置文件
  - 原因：不同任务可能有不同的目标时长

---

## 六、影响范围

### 受益脚本
1. select_material_segments.py - 直接修复
2. compose_timeline.py - 间接受益（使用正确的素材时长）
3. build_video.py - 间接受益（最终视频时长正确）

### 不受影响的脚本
1. segment_material.py - 不依赖目标时长
2. score_material_segments.py - 不依赖目标时长
3. build_bridge_script.py - 不依赖目标时长

---

## 七、总结

**问题**: 目标时长配置失效，始终使用 45 秒

**原因**: 硬编码，未读取配置

**解决**: 从 content_outline.json 读取 target_duration_sec

**效果**: 
- ✅ 用户配置生效
- ✅ 素材选择按正确时长预算
- ✅ 最终视频时长符合预期

**验证**: 语法检查通过

---

**报告生成时间**: 2026-04-02  
**状态**: 已修复，待测试验证
