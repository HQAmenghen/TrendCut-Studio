# 账号配置框折叠功能

## 功能说明

为发布中心的账号配置框添加了折叠/展开功能，让界面更简洁，特别是在有多个账号时。

## 功能特性

### 1. 点击折叠/展开
- 点击账号卡片的标题栏可以折叠/展开配置详情
- 折叠时只显示账号名称、状态徽章和操作按钮
- 展开时显示完整的配置字段

### 2. 折叠图标
- 标题栏左侧有一个三角形图标 ▶
- 折叠状态：▶（向右）
- 展开状态：▼（向下旋转 90 度）
- 图标会平滑过渡动画

### 3. 默认状态
- 页面加载时，第一个账号默认展开
- 其他账号默认折叠
- 用户可以根据需要展开/折叠任意账号

### 4. 交互优化
- 点击标题栏任意位置都可以切换折叠状态
- 复选框、按钮等交互元素不会触发折叠（使用 `@click.stop` 阻止冒泡）
- 鼠标悬停时标题栏有轻微的背景色变化，提示可点击

## 使用场景

### 场景 1：快速查看所有账号状态
1. 所有账号默认折叠
2. 只显示账号名称和登录状态徽章
3. 一眼就能看到所有账号的登录情况

### 场景 2：编辑特定账号配置
1. 点击要编辑的账号标题栏
2. 展开显示所有配置字段
3. 编辑完成后可以折叠，保持界面整洁

### 场景 3：批量检测登录状态
1. 所有账号折叠状态下
2. 勾选要检测的账号
3. 点击"检测选中"按钮
4. 查看状态徽章更新

## 界面布局

### 折叠状态
```
☑ ▶ 账号名称 [✓ 已登录] [检测登录] [扫码登录] [删除]
```

### 展开状态
```
☑ ▼ 账号名称 [✓ 已登录] [检测登录] [扫码登录] [删除]
    ├─ 账号备注
    ├─ finderUserName
    ├─ helperAccount
    └─ 其他配置字段...
```

## 技术实现

### 1. 状态管理
```javascript
const expandedAccounts = reactive(new Set());

// 切换展开/折叠
function toggleAccountExpand(accountId) {
  if (expandedAccounts.has(accountId)) {
    expandedAccounts.delete(accountId);
  } else {
    expandedAccounts.add(accountId);
  }
}
```

### 2. 模板结构
```vue
<div class="account-card-head" @click="toggleAccountExpand(account.id)">
  <span class="expand-icon" :class="{ expanded: expandedAccounts.has(account.id) }">
    ▶
  </span>
  <!-- 账号信息和按钮 -->
</div>

<div v-show="expandedAccounts.has(account.id)" class="platform-fields">
  <!-- 配置字段 -->
</div>
```

### 3. 事件处理
```vue
<!-- 标题栏可点击 -->
<div @click="toggleAccountExpand(account.id)">
  <!-- 复选框阻止冒泡 -->
  <input @change.stop="toggleWechatAccountSelection(account.id)" />

  <!-- 按钮区域阻止冒泡 -->
  <div @click.stop>
    <button>检测登录</button>
    <button>扫码登录</button>
    <button>删除</button>
  </div>
</div>
```

### 4. 样式动画
```css
.expand-icon {
  display: inline-block;
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.2s ease;
  user-select: none;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.account-card-head {
  transition: background-color 0.15s ease;
}

.account-card-head:hover {
  background-color: rgba(139, 92, 246, 0.05);
}
```

## 优势

### 1. 界面更简洁
- 多个账号时不会显得拥挤
- 折叠状态下可以一屏显示更多账号
- 减少滚动操作

### 2. 操作更高效
- 快速查看所有账号状态
- 只展开需要编辑的账号
- 批量操作时不受配置字段干扰

### 3. 体验更友好
- 平滑的动画过渡
- 清晰的视觉反馈
- 符合用户直觉的交互方式

## 注意事项

1. **默认展开第一个账号**：方便用户快速开始配置
2. **状态独立**：每个账号的展开/折叠状态互不影响
3. **事件冒泡处理**：确保复选框和按钮不会触发折叠
4. **响应式更新**：使用 `reactive(new Set())` 确保状态变化能触发视图更新

## 未来优化

可以考虑添加以下功能：
- 全部展开/全部折叠按钮
- 记住用户的折叠偏好（localStorage）
- 键盘快捷键支持（如 Space 键切换）
- 双击标题栏快速编辑账号名称
