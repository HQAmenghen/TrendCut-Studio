# 前端风格统一说明

## 🎨 设计系统

### 核心原则

MaterialDrivenWorkspace已完全遵循现有设计系统，与PipelineWorkspace、StandaloneWorkspace等组件保持一致的视觉风格。

### 统一的组件结构

```vue
<section class="[module]-page">
  <!-- Hero Panel -->
  <section class="hero-panel">
    <div class="hero-grid">
      <div class="hero-copy">
        <div class="section-kicker">...</div>
        <h3>...</h3>
        <p>...</p>
        <div class="flow-pills">...</div>
      </div>
      <div class="hero-stats">
        <div class="module-summary-card">...</div>
      </div>
    </div>
  </section>

  <!-- Workflow Status -->
  <section class="workflow-panel">
    <div class="workflow-head">...</div>
    <div class="workflow-grid">
      <article class="workflow-stage">...</article>
    </div>
  </section>

  <!-- Main Content -->
  <div class="workspace-grid">
    <div class="workspace-main">
      <div class="builder-card">...</div>
      <div class="panel">...</div>
    </div>
  </div>
</section>
```

## 📦 统一的组件类

### 1. Hero Panel（顶部面板）

**使用的类**:
- `.hero-panel` - 顶部容器
- `.hero-grid` - 网格布局
- `.hero-copy` - 左侧文案区
- `.section-kicker` - 小标签（如"Material First"）
- `.flow-pills` - 流程标签组
- `.flow-pill` - 单个流程标签
- `.hero-stats` - 右侧统计卡片区
- `.module-summary-card` - 统计卡片

**示例**:
```vue
<section class="hero-panel">
  <div class="hero-grid">
    <div class="hero-copy">
      <div class="section-kicker">Material First</div>
      <h3>素材驱动工作流</h3>
      <div class="flow-pills">
        <span class="flow-pill">素材分析</span>
        <span class="flow-pill">AI规划</span>
      </div>
    </div>
    <div class="hero-stats">
      <div class="module-summary-card">
        <span>素材状态</span>
        <strong>已上传</strong>
        <p>支持MP4格式</p>
      </div>
    </div>
  </div>
</section>
```

### 2. Workflow Panel（工作流面板）

**使用的类**:
- `.workflow-panel` - 工作流容器
- `.workflow-head` - 头部
- `.workflow-summary` - 摘要信息
- `.workflow-badge` - 状态徽章
- `.workflow-grid` - 步骤网格
- `.workflow-stage` - 单个步骤
- `.stage-completed` / `.stage-running` / `.stage-pending` - 步骤状态

**示例**:
```vue
<section class="workflow-panel">
  <div class="workflow-head">
    <div>
      <div class="section-kicker">Workflow Status</div>
      <h4>7步工作流进度</h4>
    </div>
    <div class="workflow-summary">
      <span class="workflow-badge">步骤 3/7</span>
      <strong>正在切片...</strong>
    </div>
  </div>
  <div class="workflow-grid">
    <article class="workflow-stage stage-completed">
      <div class="workflow-stage-top">
        <strong>准备素材</strong>
        <span class="workflow-stage-state">已完成</span>
      </div>
      <p class="workflow-stage-detail">复制到工作目录</p>
    </article>
  </div>
</section>
```

### 3. Builder Card（构建卡片）

**使用的类**:
- `.builder-card` - 卡片容器
- `.builder-card-header` - 卡片头部
- `.builder-card-body` - 卡片主体
- `.stack` - 垂直堆叠布局
- `.upload-grid` - 上传网格
- `.config-cluster` - 配置组
- `.config-cluster-title` - 配置组标题
- `.upload-card` - 上传卡片

**示例**:
```vue
<div class="builder-card">
  <div class="builder-card-header">
    <div>
      <h4>上传素材视频</h4>
      <p>选择素材视频文件</p>
    </div>
  </div>
  <div class="builder-card-body stack">
    <div class="upload-grid">
      <div class="config-cluster">
        <div class="config-cluster-title">素材视频</div>
        <label class="upload-card">
          <span class="upload-icon">🎬</span>
          <span class="upload-title">上传素材视频</span>
          <input type="file" hidden />
        </label>
      </div>
    </div>
  </div>
</div>
```

### 4. Panel（面板）

**使用的类**:
- `.panel` - 面板容器
- `.panel-header` - 面板头部
- `.panel-body` - 面板主体
- `.mini-status-grid` - 小状态网格
- `.mini-status-card` - 小状态卡片
- `.warning-panel` / `.success-panel` / `.error-panel` - 特殊状态面板

**示例**:
```vue
<div class="panel">
  <div class="panel-header"><span>📋 导演规划摘要</span></div>
  <div class="panel-body">
    <div class="mini-status-grid">
      <div class="mini-status-card">
        <span>总时长</span>
        <strong>45秒</strong>
      </div>
    </div>
  </div>
</div>
```

### 5. Buttons（按钮）

**使用的类**:
- `.primary-btn` - 主要按钮（蓝色渐变）
- `.btn-success` - 成功按钮（绿色）
- `.ghost-btn` - 幽灵按钮（透明边框）
- `.full-btn` - 全宽按钮
- `.helper-btn` - 辅助按钮

**示例**:
```vue
<button type="button" class="primary-btn full-btn">
  🚀 开始制作
</button>

<button type="button" class="btn-success">
  ✅ 已生成，继续混剪
</button>

<button type="button" class="ghost-btn">
  🔄 制作新视频
</button>
```

### 6. Form Elements（表单元素）

**使用的类**:
- `.input-dark` - 深色输入框
- `.field-label` - 字段标签
- `.muted-copy` - 灰色说明文字
- `.checkbox-row` - 复选框行
- `.quick-tip-card` - 快速提示卡片

**示例**:
```vue
<div>
  <label class="field-label">输出目录名称</label>
  <input type="text" class="input-dark text-sm" />
  <p class="muted-copy">留空自动生成</p>
</div>

<label class="checkbox-row">
  <input type="checkbox" />
  <div>
    <strong>启用智能剪辑</strong>
    <p>使用OST策略</p>
  </div>
</label>
```

## 🎨 颜色系统

### CSS变量（继承自全局）

```css
/* 主色调 */
--brand-a: #6d6bff;
--brand-b: #8b89ff;

/* 文本颜色 */
--strong-text: #ffffff;
--text: #e5e7eb;
--muted: #9ca3af;

/* 背景颜色 */
--card-bg: rgba(17, 24, 39, 0.8);
--input-bg: rgba(31, 41, 55, 0.6);
--console-bg: rgba(17, 24, 39, 0.95);

/* 边框颜色 */
--line-soft: rgba(75, 85, 99, 0.3);

/* 状态颜色 */
--ok: #22c55e;
--warning: #fbbf24;
--error: #ef4444;
```

### 使用示例

```css
.custom-element {
  background: var(--card-bg);
  border: 1px solid var(--line-soft);
  color: var(--text);
}

.custom-element strong {
  color: var(--strong-text);
}

.custom-element .muted {
  color: var(--muted);
}
```

## 📐 间距系统

### 统一的间距值

```css
/* 小间距 */
gap: 12px;
padding: 12px;

/* 中间距 */
gap: 16px;
padding: 16px;

/* 大间距 */
gap: 24px;
padding: 24px;

/* 卡片内部 */
.panel-body {
  padding: 20px;
}

.builder-card-body {
  padding: 24px;
}
```

## 🔤 字体系统

### 字号

```css
/* 小字 */
font-size: 12px; /* .section-kicker, .muted-copy */
font-size: 13px; /* .log-container, .checkbox-row p */

/* 正常 */
font-size: 14px; /* 正文 */

/* 标题 */
font-size: 16px; /* h4 */
font-size: 24px; /* h3 */
font-size: 32px; /* h1 */
```

### 字重

```css
font-weight: 400; /* 正常 */
font-weight: 700; /* strong, .workflow-badge */
font-weight: 800; /* .section-kicker */
font-weight: 900; /* h3, h4 */
```

## 🎭 动画效果

### 统一的过渡

```css
/* 通用过渡 */
transition: all 0.2s;
transition: all 0.3s ease;

/* 进度条 */
.progress-bar-fill {
  transition: width 0.3s ease;
}

/* 悬停效果 */
.checkbox-row:hover {
  border-color: var(--brand-a);
}
```

## 📱 响应式设计

### 继承全局响应式

MaterialDrivenWorkspace继承了全局的响应式样式：

```css
/* 来自App.vue的全局样式 */
@media (max-width: 1100px) {
  .hero-grid {
    flex-direction: column;
  }
}
```

## ✅ 风格检查清单

在创建新组件时，确保：

- [ ] 使用 `.hero-panel` 结构作为顶部
- [ ] 使用 `.section-kicker` 作为小标签
- [ ] 使用 `.flow-pills` 展示流程步骤
- [ ] 使用 `.module-summary-card` 展示统计信息
- [ ] 使用 `.workflow-panel` 展示工作流状态
- [ ] 使用 `.builder-card` 作为主要内容卡片
- [ ] 使用 `.panel` 作为信息面板
- [ ] 使用统一的按钮类（`.primary-btn`, `.ghost-btn`等）
- [ ] 使用 `.input-dark` 作为输入框样式
- [ ] 使用CSS变量而非硬编码颜色
- [ ] 使用统一的间距值（12px, 16px, 24px）
- [ ] 使用统一的字号和字重
- [ ] 添加适当的过渡动画
- [ ] 继承全局响应式样式

## 🎯 对比示例

### ❌ 错误的风格（之前的版本）

```vue
<div class="workspace material-driven-workspace">
  <div class="workspace-header">
    <h2>🎬 素材驱动工作流</h2>
  </div>
  
  <div class="workflow-steps">
    <div class="step-card">...</div>
  </div>
  
  <div class="upload-section">
    <div class="upload-card">...</div>
  </div>
</div>

<style scoped>
.material-driven-workspace {
  padding: 2rem;
}

.step-card {
  background: var(--card-bg);
  border: 2px solid var(--border-color);
}
</style>
```

**问题**:
- 使用了自定义的类名（`.workspace-header`, `.step-card`）
- 没有使用hero-panel结构
- 没有使用section-kicker
- 样式与现有组件不一致

### ✅ 正确的风格（当前版本）

```vue
<section class="material-driven-page">
  <section class="hero-panel">
    <div class="hero-grid">
      <div class="hero-copy">
        <div class="section-kicker">Material First</div>
        <h3>素材驱动工作流</h3>
        <div class="flow-pills">
          <span class="flow-pill">素材分析</span>
        </div>
      </div>
      <div class="hero-stats">
        <div class="module-summary-card">...</div>
      </div>
    </div>
  </section>
  
  <section class="workflow-panel">
    <div class="workflow-grid">
      <article class="workflow-stage">...</article>
    </div>
  </section>
  
  <div class="workspace-grid">
    <div class="workspace-main">
      <div class="builder-card">...</div>
    </div>
  </div>
</section>
```

**优点**:
- 使用了统一的hero-panel结构
- 使用了section-kicker标签
- 使用了flow-pills流程展示
- 使用了module-summary-card统计卡片
- 使用了workflow-panel工作流面板
- 使用了builder-card内容卡片
- 完全继承全局样式，无需自定义

## 🎉 总结

MaterialDrivenWorkspace现在完全遵循现有设计系统：

1. **结构统一**: 使用hero-panel、workflow-panel、builder-card等标准结构
2. **样式统一**: 使用CSS变量、统一间距、统一字体
3. **组件统一**: 使用module-summary-card、workflow-stage、panel等标准组件
4. **交互统一**: 使用primary-btn、ghost-btn等标准按钮
5. **视觉统一**: 与PipelineWorkspace、StandaloneWorkspace保持一致的视觉风格

用户无法区分MaterialDrivenWorkspace与其他workspace组件，实现了完美的风格统一。

---

**版本**: 2.0.0  
**日期**: 2026-04-03  
**状态**: ✅ 风格统一完成
