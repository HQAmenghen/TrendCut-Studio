# AI 审核与一键重新生成功能

## 功能概述

本文档介绍 AI 视频审核系统的两个重要功能改进：
1. **AutoPilot 审核检查** - 确保自动发布流程只发布通过审核的视频
2. **一键重新生成** - 根据 AI 审核建议自动重新生成视频

---

## 1. AutoPilot 审核检查

### 功能说明

在 AutoPilot（无人值守自动发布）流程中，系统现在会自动检查视频的 AI 审核状态，确保只有通过审核的视频才会被创建为发布任务。

### 检查逻辑

当视频渲染完成后，系统会：

1. **检查审核配置**
   - 如果 `reviewConfig.enabled = true` 且 `reviewConfig.require_manual_confirm = true`
   - 则执行审核状态检查

2. **审核状态判断**
   - ✅ **通过** (`status: 'passed'`) - 继续创建发布任务
   - ✅ **已跳过** (`status: 'skipped'` 或 `manuallySkipped: true`) - 继续创建发布任务
   - ⏸️ **未审核/审核中** (`status: 'pending'` 或 `'reviewing'`) - 跳过，保留在素材库
   - ❌ **未通过** (`status: 'failed'` 且未手动跳过) - 跳过，需要修复或手动跳过

3. **日志记录**
   - 所有跳过的视频都会记录详细日志
   - 包括审核状态、分数、原因等信息
   - 日志位置：`data/logs/scheduler.log`

### 配置方式

在系统设置中配置审核选项：

```json
{
  "enabled": true,                    // 启用 AI 审核
  "require_manual_confirm": true,     // 要求手动确认（启用 AutoPilot 检查）
  "min_pass_score": 70,               // 最低通过分数
  "auto_skip_on_error": false         // 审核失败时是否自动跳过
}
```

### 工作流程示例

```
1. AutoPilot 抓取榜单 → 2. 视频渲染完成 → 3. 自动触发 AI 审核
                                              ↓
                                         审核通过？
                                         ↙        ↘
                                      是           否
                                      ↓            ↓
                              创建发布任务    保留在素材库
                                      ↓            ↓
                              定时自动发布    手动处理/重新生成
```

---

## 2. 一键重新生成功能

### 功能说明

当视频 AI 审核未通过时，系统可以根据审核建议自动调整参数并重新生成视频，无需手动修改。

### 支持的优化

系统会自动分析审核建议并应用以下优化：

#### 1. **标题优化**
- 检测：`category: 'title'` 的建议
- 操作：使用 AI 推荐的备选标题
- 示例：`"可以尝试: 震惊！这个技术改变了一切"` → 自动提取并应用

#### 2. **字幕重新生成**
- 检测：`category: 'subtitle'` 且 `severity: 'high'` 的建议
- 操作：重新运行 ASR（语音识别）
- 适用场景：字幕识别错误、时间轴不准确

#### 3. **内容/剪辑问题标记**
- 检测：`category: 'content'` 或 `'editing'` 的建议
- 操作：标记为需要内容审查
- 说明：这类问题通常需要源素材调整

### 使用方式

#### 前端操作

1. 进入 **AI 视频审核中心**
2. 找到审核未通过的视频（红色标记）
3. 查看修复建议列表
4. 点击 **"重新生成"** 按钮（绿色）
5. 确认后，视频将自动加入渲染队列

#### API 调用

```bash
POST /api/review/regenerate
Content-Type: application/json

{
  "videoPath": "/path/to/video.mp4",
  "assetId": "asset_123"
}
```

**响应示例：**

```json
{
  "success": true,
  "jobId": "vertical_1234567890_abc123",
  "adjustments": {
    "titleChanged": true,
    "newTitle": "震惊！这个技术改变了一切",
    "subtitlesRegenerated": true,
    "appliedSuggestionsCount": 3
  },
  "message": "视频已加入重新生成队列"
}
```

### 重新生成流程

```
1. 读取原视频元数据
   ↓
2. 分析审核建议
   - 提取标题建议
   - 判断是否需要重新生成字幕
   - 收集高优先级问题
   ↓
3. 构建重新生成参数
   - 使用原始源信息（videoUrl, summary 等）
   - 应用优化建议
   - 标记为重新生成任务
   ↓
4. 加入渲染队列
   ↓
5. 自动渲染完成后触发新的 AI 审核
   ↓
6. 如果通过，自动创建发布任务（如果启用 AutoPilot）
```

### 元数据追踪

重新生成的视频会在元数据中记录：

```json
{
  "regeneration": {
    "status": "queued",
    "queueJobId": "vertical_1234567890_abc123",
    "previousReviewScore": 65,
    "appliedSuggestions": [
      {
        "category": "title",
        "issue": "标题吸引力可以提升"
      },
      {
        "category": "subtitle",
        "issue": "字幕识别错误: 技术 → 计数"
      }
    ],
    "startedAt": "2026-03-30T10:00:00.000Z"
  }
}
```

### 限制条件

重新生成功能仅支持以下类型的视频：

✅ **支持：**
- 通过 AutoPilot 自动流水线生成的视频
- 包含源信息（`videoUrl`, `sourceSummary`）的视频
- 有明确审核建议的视频

❌ **不支持：**
- 手动上传的视频（无源信息）
- 没有审核建议的视频
- 已删除源素材的视频

### 错误处理

| 错误代码 | 说明 | 解决方案 |
|---------|------|---------|
| `REVIEW_NO_SUGGESTIONS` | 没有可用的修复建议 | 先进行 AI 审核 |
| `REVIEW_NO_SOURCE_INFO` | 缺少源信息 | 只能手动重新制作 |
| `REVIEW_QUEUE_SERVICE_UNAVAILABLE` | 渲染服务不可用 | 检查服务状态 |

---

## 配置建议

### 推荐配置（生产环境）

```json
{
  "enabled": true,
  "require_manual_confirm": true,
  "min_pass_score": 75,
  "auto_skip_on_error": false,
  "content_weight": 30,
  "subtitle_weight": 25,
  "title_weight": 20,
  "editing_weight": 25
}
```

### 宽松配置（测试环境）

```json
{
  "enabled": true,
  "require_manual_confirm": false,
  "min_pass_score": 60,
  "auto_skip_on_error": true
}
```

---

## 监控与日志

### 关键日志位置

- **调度器日志**: `data/logs/scheduler.log` - AutoPilot 审核检查日志
- **审核日志**: 通过 Python 脚本输出到 stderr
- **队列日志**: `data/logs/vertical_queue.log` - 重新生成任务日志

### 监控指标

建议监控以下指标：

1. **审核通过率** = 通过视频数 / 总审核视频数
2. **重新生成成功率** = 重新生成后通过数 / 重新生成总数
3. **AutoPilot 跳过率** = 因审核未通过跳过的任务数 / 总任务数

---

## 常见问题

### Q1: AutoPilot 创建的任务为什么没有自动发布？

**A:** 检查以下几点：
1. 视频是否通过 AI 审核？查看审核中心
2. 审核配置中 `require_manual_confirm` 是否为 `true`？
3. 查看 `data/logs/scheduler.log` 中的跳过原因

### Q2: 重新生成后分数还是不够怎么办？

**A:**
1. 查看新的审核建议，可能需要多次迭代
2. 如果是内容/剪辑问题，可能需要更换源素材
3. 可以手动跳过审核，直接发布

### Q3: 重新生成会覆盖原视频吗？

**A:** 不会。重新生成会创建一个新的视频文件，原视频保持不变。

### Q4: 如何禁用 AutoPilot 的审核检查？

**A:** 在审核配置中设置 `require_manual_confirm: false`，或完全禁用审核 `enabled: false`。

---

## 更新日志

- **2026-03-30**: 初始版本
  - 实现 AutoPilot 审核检查
  - 实现一键重新生成功能
  - 支持标题优化和字幕重新生成
