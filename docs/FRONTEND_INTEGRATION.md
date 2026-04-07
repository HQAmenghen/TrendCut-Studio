# 前端集成完成文档

## ✅ 集成内容

### 1. 前端组件

#### MaterialDrivenWorkspace.vue
**位置**: `frontend/src/components/MaterialDrivenWorkspace.vue`

**功能**:
- 7步工作流可视化
- 文件上传和配置
- 实时进度显示
- 规划摘要展示
- 解说词摘要展示
- 日志输出
- 错误处理
- 最终视频预览

**关键特性**:
```vue
<template>
  <!-- 工作流程图 -->
  <div class="workflow-steps">
    <div v-for="step in steps" :class="{ active, completed, error }">
      <!-- 步骤卡片 -->
    </div>
  </div>

  <!-- 上传素材区域 -->
  <div v-if="!jobId" class="upload-section">
    <!-- 文件选择 + 配置选项 -->
  </div>

  <!-- 进度显示区域 -->
  <div v-else class="progress-section">
    <!-- 当前步骤详情 + 规划摘要 + 解说词摘要 + 日志 -->
  </div>
</template>
```

#### useMaterialDriven.js
**位置**: `frontend/src/composables/useMaterialDriven.js`

**功能**:
- 状态管理（jobId, currentStep, progress等）
- SSE连接管理
- 事件处理（step, progress, status, plan_summary, narration_summary, complete, error）
- API调用（startWorkflow, continueWorkflow, retryStep, resetWorkflow）

**关键方法**:
```javascript
export function useMaterialDriven() {
  // 状态
  const jobId = ref(null);
  const currentStep = ref(0);
  const progress = ref(0);
  
  // 启动工作流
  const startWorkflow = async ({ file, config }) => {
    // 上传文件 + 启动流程
    // 连接SSE监听进度
  };
  
  // SSE连接
  const connectEventSource = (id) => {
    eventSource = new EventSource(`/api/material-driven/progress/${id}`);
    // 监听各种事件
  };
  
  return { /* ... */ };
}
```

### 2. 导航集成

#### App.vue 修改

**添加导入**:
```javascript
import MaterialDrivenWorkspace from './components/MaterialDrivenWorkspace.vue';
import { useMaterialDriven } from './composables/useMaterialDriven';
```

**添加导航项**:
```javascript
const navItems = [
  { key: 'pipeline', ... },
  { 
    key: 'materialDriven', 
    kicker: 'Material First', 
    title: '🎥 素材驱动工作流', 
    desc: '从素材视频到数字人成片的完整自动化流程（OST智能剪辑）。' 
  },
  { key: 'standalone', ... },
  // ...
];
```

**添加组件实例**:
```javascript
const materialDriven = useMaterialDriven();
```

**添加模板**:
```vue
<MaterialDrivenWorkspace
  v-else-if="activeModule === 'materialDriven'"
  :job-id="materialDriven.jobId.value"
  :current-step="materialDriven.currentStep.value"
  <!-- 其他props -->
  @start-workflow="materialDriven.startWorkflow"
  @continue-workflow="materialDriven.continueWorkflow"
  @retry-step="materialDriven.retryStep"
  @reset-workflow="materialDriven.resetWorkflow"
/>
```

### 3. 后端API路由

#### materialDriven.js
**位置**: `server/routes/materialDriven.js`

**API端点**:

1. **POST /api/material-driven/start**
   - 上传素材文件
   - 启动Python工作流
   - 返回jobId和outputPath

2. **GET /api/material-driven/progress/:jobId**
   - SSE连接
   - 实时推送进度事件

3. **POST /api/material-driven/continue/:jobId**
   - 继续执行（从步骤7开始）
   - 用于手动生成数字人后继续混剪

4. **POST /api/material-driven/retry/:jobId**
   - 重试指定步骤
   - 用于错误恢复

**SSE事件类型**:
```javascript
// 步骤变化
sendEvent(jobId, 'step', { step, message });

// 进度更新
sendEvent(jobId, 'progress', { percent, message });

// 状态消息
sendEvent(jobId, 'status', { message });

// 规划摘要
sendEvent(jobId, 'plan_summary', { 
  totalDuration, 
  materialRatio, 
  aimanRatio 
});

// 解说词摘要
sendEvent(jobId, 'narration_summary', { 
  targetDuration, 
  charCount, 
  speed, 
  fullText 
});

// 完成
sendEvent(jobId, 'complete', { videoUrl });

// 错误
sendEvent(jobId, 'error_event', { message });
```

#### server.js 集成

**添加导入**:
```javascript
const { registerMaterialDrivenRoutes } = require('./server/routes/materialDriven');
```

**注册路由**:
```javascript
registerMaterialDrivenRoutes(app, paths);
```

## 🎯 工作流程

### 用户操作流程

```
1. 用户点击导航 "🎥 素材驱动工作流"
   ↓
2. 选择素材视频文件
   ↓
3. 配置选项:
   - 启用智能剪辑（默认开启）
   - 自动生成数字人（可选）
   - 输出目录名称（可选）
   ↓
4. 点击"开始制作"
   ↓
5. 前端上传文件到 /api/material-driven/start
   ↓
6. 后端启动Python脚本
   ↓
7. 前端连接SSE监听进度
   ↓
8. 实时显示:
   - 当前步骤
   - 进度百分比
   - 状态消息
   - 规划摘要（步骤4完成后）
   - 解说词摘要（步骤5完成后）
   - 执行日志
   ↓
9a. 如果自动生成=true:
    - 自动执行到步骤7
    - 完成后显示最终视频
    
9b. 如果自动生成=false:
    - 执行到步骤5暂停
    - 显示"需要生成数字人"提示
    - 用户手动生成数字人
    - 点击"继续"按钮
    - 执行步骤7混剪
    - 完成后显示最终视频
```

### 技术流程

```
前端 (MaterialDrivenWorkspace.vue)
  ↓ startWorkflow({ file, config })
useMaterialDriven.js
  ↓ POST /api/material-driven/start
后端 (materialDriven.js)
  ↓ 启动Python脚本
Python (run_material_driven.py)
  ↓ 执行7步工作流
  ↓ 输出日志到stdout
后端 (materialDriven.js)
  ↓ 解析日志
  ↓ sendEvent(jobId, eventType, data)
SSE (progress/:jobId)
  ↓ 推送事件到前端
useMaterialDriven.js
  ↓ eventSource.addEventListener()
  ↓ 更新状态
MaterialDrivenWorkspace.vue
  ↓ 响应式显示
用户界面更新
```

## 📁 文件结构

```
comfy_panel_demo/
├── frontend/
│   └── src/
│       ├── components/
│       │   └── MaterialDrivenWorkspace.vue  ✅ 新增
│       ├── composables/
│       │   └── useMaterialDriven.js         ✅ 新增
│       └── App.vue                          ✅ 修改
├── server/
│   └── routes/
│       └── materialDriven.js                ✅ 新增
├── server.js                                ✅ 修改
└── python/
    └── pipeline/
        ├── smart_video_composer.py          ✅ 新增
        └── run_material_driven.py           ✅ 已存在
```

## 🎨 UI特性

### 工作流程图
- 7个步骤卡片
- 实时状态指示（pending/active/completed/error）
- 进度动画（旋转图标）

### 上传区域
- 拖拽上传支持
- 文件类型验证
- 配置选项（智能剪辑、自动生成）

### 进度显示
- 当前步骤详情
- 进度条（0-100%）
- 状态消息
- 规划摘要卡片（3个指标）
- 解说词摘要卡片（3个指标+完整文本）

### 日志输出
- 滚动日志容器
- 时间戳
- 日志类型（info/success/error）
- 最多保留50条

### 结果展示
- 视频播放器
- 下载按钮
- 重新制作按钮

### 错误处理
- 错误消息显示
- 重试按钮
- 重新开始按钮

## 🔧 配置

### 前端配置
无需额外配置，使用默认API端点。

### 后端配置
在 `.env` 文件中配置Python环境和依赖：

```bash
# ComfyUI
COMFYUI_BASE_URL=https://your-comfyui:8443

# LLM
LLM_PROVIDER=qwen
QWEN_API_KEY=your_key

# 智能剪辑
SMART_CLIP_HWACCEL_ENABLED=true
SMART_CLIP_AUDIO_ENABLED=true
```

## 🚀 启动

### 开发模式

```bash
# 启动后端
npm run dev

# 启动前端（另一个终端）
cd frontend
npm run dev
```

### 生产模式

```bash
# 构建前端
cd frontend
npm run build

# 启动服务器
npm start
```

## 🎯 测试流程

1. 启动服务器
2. 访问 http://localhost:3000
3. 点击导航 "🎥 素材驱动工作流"
4. 上传测试素材视频
5. 配置选项（建议先禁用自动生成）
6. 点击"开始制作"
7. 观察进度显示
8. 等待步骤5完成
9. 手动生成数字人（通过ComfyUI）
10. 点击"继续"按钮
11. 等待混剪完成
12. 查看最终视频

## 📊 性能优化

### 前端
- 使用SSE而非轮询（减少请求）
- 日志限制50条（避免内存泄漏）
- 组件懒加载（v-if）

### 后端
- 使用Map存储活跃任务（快速查找）
- 进程管理（spawn + 事件监听）
- 自动清理完成任务

### Python
- 硬件加速（3-5倍提速）
- 智能Fallback（保证成功）
- 断点续传（节省时间）

## 🐛 故障排查

### 问题1: SSE连接失败

**症状**: 前端无法接收进度更新

**解决**:
1. 检查后端是否启动
2. 检查防火墙设置
3. 检查浏览器控制台错误

### 问题2: Python脚本启动失败

**症状**: 后端日志显示spawn错误

**解决**:
1. 检查Python是否安装
2. 检查脚本路径是否正确
3. 检查依赖是否安装

### 问题3: 文件上传失败

**症状**: 上传后无响应

**解决**:
1. 检查文件大小限制
2. 检查uploads目录权限
3. 检查multer配置

## 🎉 集成完成

- ✅ 前端组件（MaterialDrivenWorkspace.vue）
- ✅ 状态管理（useMaterialDriven.js）
- ✅ 导航集成（App.vue）
- ✅ 后端路由（materialDriven.js）
- ✅ SSE支持（实时进度）
- ✅ 文件上传（multer）
- ✅ 进程管理（spawn）
- ✅ 错误处理（重试/重置）

---

**版本**: 1.0.0  
**日期**: 2026-04-03  
**状态**: ✅ 完成并可测试
