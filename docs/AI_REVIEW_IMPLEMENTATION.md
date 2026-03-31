# AI视频审核系统 - 完整实施文档

## ✅ 已完成功能

### 1. 核心审核系统
- ✅ Python 审核脚本 (`python/review/ai_video_review.py`)
- ✅ 使用 Gemini 2.5 Flash 进行多模态视频分析
- ✅ 四维度评分：内容质量、字幕准确性、标题吸引力、剪辑质量
- ✅ 自动生成修复建议
- ✅ SQLite 数据库存储审核记录

### 2. Server 端服务
- ✅ 数据库操作 (`server/services/review/store.js`)
- ✅ Python 脚本执行器 (`server/services/review/executor.js`)
- ✅ API 请求处理器 (`server/services/review/handlers.js`)
- ✅ 路由定义 (`server/routes/review.js`)
- ✅ 集成到主服务器 (`server.js`)

### 3. 前端集成
- ✅ 审核逻辑 composable (`frontend/src/composables/useVideoReview.js`)
- ✅ 审核结果卡片组件 (`frontend/src/components/ReviewResultCard.vue`)
- ✅ 发布中心集成 (`frontend/src/components/PublishCenterWorkspace.vue`)
  - 素材列表显示审核状态
  - 审核按钮
  - 审核结果展示
  - 跳过审核功能

### 4. 自动化流程集成
- ✅ 视频生成完成后自动触发审核
- ✅ 发布任务创建前检查审核状态
- ✅ AutoPilot 流程自动受益（通过上述两个集成点）

## 🎯 工作流程

### 手动审核流程
```
1. 用户在发布中心查看素材列表
2. 点击"审核"按钮
3. 系统调用 Gemini 2.5 Flash 分析视频
4. 显示审核结果（得分 + 建议）
5. 用户决定：
   - 通过 → 创建发布任务
   - 未通过 → 查看建议 / 跳过审核 / 重新生成
```

### 自动审核流程
```
1. 视频生成完成
2. 自动触发 AI 审核
3. 审核结果保存到元数据
4. 用户创建发布任务时：
   - 如果审核通过 → 正常创建
   - 如果审核未通过 → 提示查看建议或跳过
   - 如果未审核 → 提示先审核
```

### AutoPilot 自动化流程
```
1. AutoPilot 抓取热点榜单
2. 自动生成视频
3. 视频生成完成后自动触发审核 ✅
4. 审核通过后自动创建发布任务 ✅
5. 自动发布到各平台
```

## 📡 API 接口

| 接口 | 方法 | 功能 |
|------|------|------|
| `/api/review/config` | GET | 获取审核配置 |
| `/api/review/config` | POST | 更新审核配置 |
| `/api/review/video` | POST | 执行视频审核 |
| `/api/review/skip` | POST | 手动跳过审核 |
| `/api/review/history` | GET | 获取审核历史 |
| `/api/review/:reviewId` | GET | 获取单个审核记录 |
| `/api/review/:reviewId` | DELETE | 删除审核记录 |

## ⚙️ 配置说明

### 环境变量 (.env)
```env
# AI Review
AI_REVIEW_ENABLED=true                      # 启用/禁用审核
AI_REVIEW_MIN_PASS_SCORE=70                 # 最低通过分数 (0-100)
AI_REVIEW_GEMINI_MODEL=gemini-2.5-flash    # 使用的模型
AI_REVIEW_AUTO_SKIP_ON_ERROR=false          # 错误时自动跳过
AI_REVIEW_REQUIRE_MANUAL_CONFIRM=true      # 需要手动确认
```

### 数据库配置
审核配置存储在 `data/ai_review.db` 中，包括：
- `enabled`: 是否启用审核
- `min_pass_score`: 最低通过分数
- `content_weight`: 内容质量权重 (默认 30%)
- `subtitle_weight`: 字幕准确性权重 (默认 25%)
- `title_weight`: 标题吸引力权重 (默认 20%)
- `editing_weight`: 剪辑质量权重 (默认 25%)
- `gemini_model`: 使用的 Gemini 模型
- `gemini_timeout`: 审核超时时间 (秒)

## 🚀 使用指南

### 1. 启动服务
```bash
npm start
```

### 2. 手动审核视频
1. 打开发布中心 (http://localhost:3001)
2. 在素材列表中找到要审核的视频
3. 点击"审核"按钮
4. 等待审核完成（约 10-30 秒）
5. 查看审核结果和建议

### 3. 配置审核参数
通过 API 或数据库直接修改配置：
```bash
curl -X POST http://localhost:3001/api/review/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "min_pass_score": 75,
    "content_weight": 35,
    "subtitle_weight": 25,
    "title_weight": 20,
    "editing_weight": 20
  }'
```

### 4. 查看审核历史
```bash
curl http://localhost:3001/api/review/history?limit=10
```

### 5. 测试审核脚本
```bash
python python/review/ai_video_review.py \
  --video public/output_final.mp4 \
  --metadata public/output_final.mp4.meta.json \
  --output /tmp/review_result.json
```

## 📊 审核评分标准

### 内容质量 (30%)
- 画面清晰度和稳定性
- 内容连贯性和逻辑性
- 信息准确性和价值
- 视觉吸引力

### 字幕准确性 (25%)
- 字幕与音频的同步准确性
- 文字识别准确率
- 标点符号和断句合理性
- 字幕时长和可读性

### 标题吸引力 (20%)
- 标题与内容的匹配度
- 标题的吸引力和点击欲望
- 关键词使用效果
- 长度和可读性

### 剪辑质量 (25%)
- 转场流畅度
- 节奏把控
- 画面构图
- 音频质量

## 💰 成本分析

### 使用 Gemini 2.5 Flash
- 单次审核成本：约 ¥0.15
- 审核时间：10-30 秒
- 月审核 300 次：约 ¥45

### ROI 计算
- 人工审核时间：5 分钟/视频
- AI 审核时间：20 秒/视频
- 节省时间：4.7 分钟/视频
- 月审核 300 次：节省 23.5 小时
- 按时薪 ¥200 计算：月节省 ¥4,700
- **净收益：¥4,655/月**

## 🔧 故障排查

### 1. 审核失败
**问题**：审核脚本执行失败
**解决**：
- 检查 Gemini API Key 是否正确
- 检查网络连接
- 查看 `data/logs/scheduler.log` 日志
- 确认视频文件和元数据文件存在

### 2. 审核超时
**问题**：审核时间过长
**解决**：
- 增加 `gemini_timeout` 配置
- 检查视频文件大小（建议 < 100MB）
- 考虑使用更快的模型（gemini-2.5-flash）

### 3. 前端不显示审核状态
**问题**：素材列表不显示审核徽章
**解决**：
- 刷新素材列表
- 检查元数据文件中是否有 `aiReview` 字段
- 清除浏览器缓存

### 4. 发布任务创建被阻止
**问题**：提示"该视频尚未通过AI审核"
**解决**：
- 点击"审核"按钮进行审核
- 或点击"跳过审核"继续创建任务
- 或在配置中禁用 `require_manual_confirm`

## 📈 未来优化方向

1. **自动修复**：根据审核建议自动调整字幕、标题
2. **批量审核**：支持一次审核多个视频
3. **审核模板**：针对不同内容类型使用不同审核标准
4. **学习优化**：根据历史审核结果优化评分模型
5. **审核报告**：生成周期性审核质量报告
6. **A/B测试**：对比审核前后的发布效果
7. **审核配置界面**：前端可视化配置审核参数

## 📝 文件清单

### 新增文件
```
python/review/
├── __init__.py
└── ai_video_review.py

server/services/review/
├── handlers.js
├── store.js
├── executor.js
└── index.js

server/routes/
└── review.js

frontend/src/components/
├── ReviewResultCard.vue

frontend/src/composables/
└── useVideoReview.js

data/
└── ai_review.db
```

### 修改文件
```
server.js                                    # 注册审核路由、自动审核触发
server/services/pipeline/handlers.js        # 视频生成后自动审核
server/services/publish/handlers.js         # 发布前检查审核状态
frontend/src/components/PublishCenterWorkspace.vue  # 审核UI集成
.env.example                                 # 审核配置项
```

## 🎉 总结

AI视频审核系统已完全集成到你的视频生产流程中：

✅ **自动化**：视频生成后自动审核
✅ **智能化**：Gemini 2.5 Flash 多维度分析
✅ **可控化**：支持手动跳过、配置阈值
✅ **可视化**：前端直观展示审核结果
✅ **高效化**：大幅减少人工审核时间

现在你的 AutoPilot 流程会：
1. 自动抓取热点
2. 自动生成视频
3. **自动审核质量** ✨
4. 审核通过后自动发布

这将显著提升内容质量和生产效率！
