# 登录检测逻辑修复与功能整合

## 问题修复

### 1. 误判已登录状态

**问题描述：**
有的账号并没有登录，但检测结果显示已经登录。

**原因分析：**
之前的判断逻辑太宽松：
```python
# 旧逻辑：只要 URL 或 UI 任一匹配就认为已登录
if dashboard_url or dashboard_ui:
    has_dashboard = True
```

这导致在页面跳转过程中，URL 可能已经是 dashboard，但页面还在加载或实际上会跳转到登录页，造成误判。

**修复方案：**
采用更严格的判断逻辑：
```python
# 新逻辑：必须同时满足 URL 和 UI 才认为已登录
if dashboard_url and dashboard_ui:
    has_dashboard = True
```

同时增加等待时间，确保页面完全加载：
```python
# 等待页面加载和可能的跳转完成
time.sleep(3)  # 原有等待
time.sleep(2)  # 新增等待，总共 5 秒
```

**判断优先级：**
1. 如果检测到登录页面（URL 或 UI），标记为需要登录
2. 只有当 URL 是 dashboard **且** UI 也匹配时，才认为已登录
3. 这样可以避免页面跳转过程中的误判

## 功能整合

### 2. 移动到发布中心

**改进前：**
登录状态检测功能单独放在系统设置页面，与账号管理分离。

**改进后：**
直接集成到发布中心的账号管理区域，与"扫码登录"按钮并列。

**新增功能：**

#### 账号列表增强
每个账号卡片现在显示：
- ☑️ **复选框**：可以选择多个账号进行批量检测
- 🟢 **登录状态徽章**：实时显示账号登录状态
  - ✓ 已登录（绿色）
  - ⚠ 需登录（黄色）
  - ✗ 异常（红色）
  - 检测中（蓝色）
- 🔍 **检测登录**按钮：快速检测单个账号
- 🔐 **扫码登录**按钮：原有的扫码功能

#### 批量操作
选中多个账号后，顶部会显示：
- **检测选中 (N)** 按钮：批量检测选中的账号
- 默认串行检测，不发送飞书通知
- 检测完成后显示汇总结果

## 使用场景

### 场景 1：快速检查单个账号
1. 在发布中心找到要检查的账号
2. 点击"检测登录"按钮
3. 浏览器自动打开并检测
4. 检测完成后自动关闭
5. 状态徽章更新显示结果

### 场景 2：批量检测多个账号
1. 勾选要检测的账号（如 2-3 个）
2. 点击顶部的"检测选中 (N)"按钮
3. 系统串行检测每个账号
4. 检测完成后弹出汇总结果
5. 状态徽章更新显示结果

### 场景 3：发布前确认登录状态
1. 创建发布任务前，先查看账号状态徽章
2. 如果显示"需登录"，点击"扫码登录"
3. 扫码完成后，点击"检测登录"确认
4. 确认"已登录"后再创建发布任务

### 场景 4：定时自动检测（后台）
- 系统仍会按照配置的间隔（默认 30 分钟）自动检测
- 自动检测采用串行模式
- 检测到掉登录会发送飞书通知（包含二维码）
- 前端页面会自动更新状态徽章

## 技术细节

### 检测逻辑改进

#### 1. 更严格的状态判断
```python
def classify_browser_state(browser):
    has_login = False
    has_dashboard = False

    for page in browser.pages:
        login_url = is_on_login_page(url)
        dashboard_url = is_on_dashboard(url)
        login_ui = page_has_login_ui(page)
        dashboard_ui = page_has_dashboard_ui(page)

        # 检测到登录页面
        if login_url or login_ui:
            has_login = True

        # 必须同时满足 URL 和 UI 才认为已登录
        if dashboard_url and dashboard_ui:
            has_dashboard = True

    # 优先返回已登录状态
    if has_dashboard:
        return "dashboard"
    if has_login:
        return "login"
    return "unknown"
```

#### 2. 增加等待时间
```python
# 访问页面后等待 5 秒，确保页面完全加载和跳转完成
page.goto("https://channels.weixin.qq.com/platform", ...)
time.sleep(3)  # 等待客户端跳转
time.sleep(2)  # 新增：等待页面完全加载
```

#### 3. 浏览器标题显示账号
```python
page.evaluate(f"""() => {{
    document.title = '登录检测 - {account_display}';
}}""")
```

### 前端集成

#### 1. 状态管理
```javascript
const accountLoginStatus = reactive({});  // 账号登录状态
const checkingLoginAccounts = reactive(new Set());  // 正在检测的账号
const selectedWechatAccounts = ref([]);  // 选中的账号
```

#### 2. 自动加载状态
```javascript
onMounted(() => {
  loadAllLoginStatus();  // 页面加载时获取所有账号状态
});
```

#### 3. 单个检测
```javascript
async function checkSingleAccountLogin(accountId) {
  const res = await fetch(`/api/login-status/check/${accountId}`, {
    method: 'POST'
  });
  // 更新状态徽章
  accountLoginStatus[accountId] = data.result;
}
```

#### 4. 批量检测
```javascript
async function checkSelectedAccountsLogin() {
  const res = await fetch('/api/login-status/check-batch', {
    method: 'POST',
    body: JSON.stringify({
      accountIds: selectedWechatAccounts.value,
      notifyFeishu: false,  // 手动检测不发通知
      parallel: false       // 串行检测
    })
  });
}
```

## 配置说明

### 环境变量（不变）
```bash
LOGIN_CHECK_ENABLED=true              # 是否启用定时检测
LOGIN_CHECK_INTERVAL_MINUTES=30       # 检测间隔（分钟）
LOGIN_CHECK_RETRY_TIMES=3             # 失败重试次数
FEISHU_NOTIFY_LOGIN_STATUS=true       # 定时检测时是否发送通知
```

### 检测模式对比

| 检测方式 | 触发位置 | 发送通知 | 检测模式 | 使用场景 |
|---------|---------|---------|---------|---------|
| 单个检测 | 发布中心账号卡片 | 否 | 单个 | 快速检查 |
| 批量检测 | 发布中心顶部按钮 | 否 | 串行 | 批量检查 |
| 定时检测 | 后台自动 | 是 | 串行 | 自动监控 |

## 注意事项

1. **判断逻辑更严格**：现在必须同时满足 URL 和 UI 条件才认为已登录，避免误判
2. **等待时间更长**：从 3 秒增加到 5 秒，确保页面完全加载
3. **手动检测不发通知**：在发布中心的手动检测不会发送飞书通知，避免打扰
4. **定时检测仍发通知**：后台定时检测仍会发送通知，确保及时告警
5. **状态自动更新**：检测完成后，状态徽章会自动更新
6. **浏览器自动关闭**：检测完成后浏览器会自动关闭（已登录 2 秒，需登录 180 秒）

## 故障排查

### 问题：仍然误判已登录
- 检查 UI 选择器是否匹配当前页面元素
- 增加等待时间（修改 `time.sleep` 的值）
- 查看控制台日志中的 `details` 字段，确认 URL 和 UI 的匹配情况

### 问题：检测太慢
- 当前等待时间为 5 秒，可以根据实际情况调整
- 如果网络很快，可以减少到 3-4 秒
- 如果网络很慢，可能需要增加到 6-8 秒

### 问题：状态徽章不更新
- 刷新页面重新加载状态
- 检查浏览器控制台是否有错误
- 确认后端 API 正常响应

### 问题：批量检测失败
- 检查是否选中了账号
- 查看浏览器控制台错误信息
- 确认后端服务正常运行
