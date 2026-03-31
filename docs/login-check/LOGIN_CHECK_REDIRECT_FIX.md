# 登录检测重定向问题修复

## 问题描述

1. **未登录账号窗口不关闭**：页面先访问 dashboard，然后重定向到 login.html，导致判断错误
2. **飞书没有收到任何信息**：文字和图片都没有收到

## 根本原因

### 问题 1：重定向导致误判

**页面访问流程：**
```
访问 /platform → 检查登录状态 → 未登录 → 重定向到 login.html
```

**之前的判断逻辑问题：**
```python
# 如果 URL 是 dashboard 但没有检测到登录 UI，也认为是 dashboard
elif dashboard_url and not login_ui:
    has_dashboard = True
```

**导致的问题：**
1. 访问 /platform 时，URL 是 dashboard
2. 页面还在加载，login_ui 还没渲染
3. 被判断为 "已登录"
4. 浏览器关闭
5. 但实际上页面会重定向到 login.html（未登录）

### 问题 2：飞书通知未触发

可能的原因：
1. 状态判断错误，没有进入通知逻辑
2. 飞书配置问题
3. 卡片消息发送失败但没有详细日志

## 解决方案

### 1. 等待重定向完成

```python
# 等待可能的重定向完成（未登录时会从 /platform 重定向到 login.html）
# 检查 URL 是否稳定
initial_url = page.url
time.sleep(2)
final_url = page.url
if initial_url != final_url:
    ulog(f"Detected redirect: {initial_url[:80]} -> {final_url[:80]}")
    # 如果发生了重定向，再等待一下确保页面加载完成
    time.sleep(2)
```

**改进：**
- 检测 URL 是否发生变化
- 如果发生重定向，再等待 2 秒
- 确保在最终页面上进行状态判断

### 2. 调整判断优先级

```python
def classify_browser_state(browser):
    # 判断逻辑（修复重定向问题）：
    # 1. 如果 URL 明确是登录页面（包含 login.html），优先判断为需要登录
    # 2. 如果检测到登录 UI，标记为需要登录
    # 3. 如果 URL 是 dashboard 且 UI 也匹配，确定已登录
    # 4. 避免在重定向过程中误判

    # 优先检查是否在登录页面
    if login_url:
        has_login = True
    elif login_ui:
        has_login = True

    # 只有当 URL 是 dashboard 且 UI 也匹配时，才认为已登录
    # 移除之前的 "URL 是 dashboard 但没有登录 UI" 的判断
    if dashboard_url and dashboard_ui:
        has_dashboard = True

    # 优先判断需要登录状态（避免重定向时误判为已登录）
    if has_login:
        return "login", details
    # 其次判断已登录状态
    if has_dashboard:
        return "dashboard", details
    # 如果都不满足，返回 unknown
    return "unknown", details
```

**关键改进：**
1. **优先判断登录状态**：先检查是否需要登录，再检查是否已登录
2. **移除宽松判断**：不再使用 "URL 是 dashboard 但没有登录 UI" 的判断
3. **严格要求**：必须同时满足 URL 和 UI 才认为已登录

### 3. 增加详细的飞书日志

```javascript
async sendLoginAlert(accountInfo, status, details = {}) {
  console.log('[Feishu] sendLoginAlert 被调用:', {
    accountId: accountInfo.id,
    status,
    mode: this.mode,
    hasQrCodePath: !!details.qrCodePath,
    hasReceiveId: !!details.receiveId
  });

  // ... 发送图片 ...

  console.log('[Feishu] 准备发送卡片消息...');
  const result = await this.sendCard(card);
  console.log('[Feishu] 卡片消息发送结果:', result);
  return result;
}
```

**日志改进：**
- 记录方法被调用的参数
- 记录图片发送的详细过程
- 记录卡片消息的发送结果
- 方便排查问题

## 完整的检测流程

```
1. 访问 https://channels.weixin.qq.com/platform
   ↓
2. 等待 5 秒（3 秒 + 2 秒）
   ↓
3. 检测 URL 是否稳定（检测重定向）
   ├─ URL 变化 → 等待 2 秒 → 继续
   └─ URL 不变 → 继续
   ↓
4. 检测浏览器状态
   ├─ 优先检查：是否在登录页面（URL 或 UI）
   │  └─ 是 → 返回 "login"
   ├─ 其次检查：是否在 dashboard（URL 且 UI）
   │  └─ 是 → 返回 "dashboard"
   └─ 都不满足 → 返回 "unknown"
   ↓
5. 根据状态处理
   ├─ dashboard → 已登录 → 关闭浏览器 ✓
   ├─ login → 需要登录 → 显示二维码 → 发送飞书通知
   └─ unknown → 再等待 3 秒 → 重新检测
```

## 判断逻辑对比

### 之前的逻辑（有问题）

```python
# 判断优先级
if dashboard_url and dashboard_ui:
    has_dashboard = True
elif dashboard_url and not login_ui:  # 问题：重定向时会误判
    has_dashboard = True

if login_url or login_ui:
    has_login = True

# 返回优先级
if has_dashboard:  # 优先返回 dashboard
    return "dashboard"
if has_login:
    return "login"
```

**问题：**
- 重定向时 URL 是 dashboard，但还没有 login_ui
- 被判断为 dashboard，浏览器关闭
- 实际上页面会重定向到 login.html

### 现在的逻辑（已修复）

```python
# 判断优先级
if login_url:  # 优先检查登录 URL
    has_login = True
elif login_ui:
    has_login = True

if dashboard_url and dashboard_ui:  # 严格要求同时满足
    has_dashboard = True

# 返回优先级
if has_login:  # 优先返回 login
    return "login"
if has_dashboard:
    return "dashboard"
```

**改进：**
- 优先检查是否需要登录
- 严格要求 dashboard 必须同时满足 URL 和 UI
- 避免重定向时误判

## 测试步骤

### 测试 1：未登录账号的检测

1. 使用未登录的账号
2. 点击"检测登录"
3. 观察日志输出：
   ```
   WECHAT_LOGIN_CHECK|Navigating to channels platform...
   WECHAT_LOGIN_CHECK|Detected redirect: https://channels.weixin.qq.com/platform -> https://channels.weixin.qq.com/platform/login.html
   WECHAT_LOGIN_CHECK|Initial browser state=login details=[...]
   WECHAT_LOGIN_CHECK|On login page — QR scan needed
   ```
4. 预期结果：
   - 识别为登录页面
   - 显示二维码
   - 发送飞书通知（如果启用）
   - 等待扫码或超时后关闭

### 测试 2：飞书通知

1. 确认飞书配置正确
2. 使用未登录的账号
3. 启用飞书通知（定时检测或手动检测时勾选"发送飞书"）
4. 观察日志输出：
   ```
   [LoginStatus] 账号 xxx 状态: need_login (首次检测: true, 状态变化: false)
   [LoginStatus] 发送飞书通知: xxx 无 -> need_login
   [Feishu] sendLoginAlert 被调用: {...}
   [Feishu] 准备上传并发送二维码图片...
   [Feishu] 图片上传成功，准备发送...
   [Feishu] 二维码图片已发送
   [Feishu] 准备发送卡片消息...
   [Feishu] 卡片消息发送结果: { success: true }
   ```
5. 预期结果：
   - 飞书群聊收到二维码图片
   - 飞书群聊收到告警卡片

## 故障排查

### 问题：浏览器仍然不关闭

1. 检查日志中的状态判断：
   ```
   WECHAT_LOGIN_CHECK|Initial browser state=xxx details=[...]
   ```
2. 查看 `details` 中的字段：
   - `login_url`: 是否为 true
   - `login_ui`: 是否为 true
   - `dashboard_url`: 是否为 true
   - `dashboard_ui`: 是否为 true
3. 如果状态仍然是 "unknown"：
   - 增加等待时间
   - 检查 UI 选择器是否匹配

### 问题：飞书仍然没有收到消息

1. 检查日志中是否有 `[Feishu] sendLoginAlert 被调用`
   - 如果没有：检查通知条件判断
   - 如果有：继续下一步

2. 检查飞书配置：
   ```bash
   # 确认环境变量
   echo $FEISHU_APP_ID
   echo $FEISHU_APP_SECRET
   echo $FEISHU_RECEIVE_ID
   ```

3. 检查飞书模式：
   ```
   [Feishu] 飞书通知服务已启用（应用模式，支持发送图片）
   ```
   - 如果是 Webhook 模式，不支持发送图片

4. 检查图片发送日志：
   ```
   [Feishu] 准备上传并发送二维码图片...
   [Feishu] 图片上传成功，准备发送...
   [Feishu] 二维码图片已发送
   ```
   - 如果有错误，查看错误信息

5. 检查卡片消息发送日志：
   ```
   [Feishu] 准备发送卡片消息...
   [Feishu] 卡片消息发送结果: { success: true }
   ```
   - 如果 `success: false`，查看 `error` 字段

### 问题：图片发送失败

1. 检查飞书应用权限：
   - `im:resource` - 上传图片资源
   - `im:message` - 发送消息
   - `im:message:send_as_bot` - 以应用身份发消息

2. 检查机器人是否在群聊中：
   - 打开飞书群聊
   - 查看群成员列表
   - 确认应用机器人在列表中

3. 检查图片文件是否存在：
   ```bash
   ls -la temp_qrcode.png
   ```

4. 检查 `receiveId` 是否正确：
   - 格式应该是 `oc_xxx`
   - 可以通过飞书 API 获取群聊列表确认

## 配置检查清单

- [ ] `FEISHU_APP_ID` 已配置
- [ ] `FEISHU_APP_SECRET` 已配置
- [ ] `FEISHU_RECEIVE_ID` 已配置（格式：oc_xxx）
- [ ] `FEISHU_RECEIVE_ID_TYPE` 设置为 `chat_id`
- [ ] `FEISHU_NOTIFY_LOGIN_STATUS` 设置为 `true`
- [ ] 飞书应用权限已配置（im:resource, im:message, im:message:send_as_bot）
- [ ] 飞书应用已发布版本
- [ ] 应用机器人已添加到目标群聊
- [ ] 服务已重启

## 预期日志输出

### 成功的检测流程（未登录）

```
WECHAT_LOGIN_CHECK|Starting login check for account_xxx (headed)
WECHAT_LOGIN_CHECK|Navigating to channels platform...
WECHAT_LOGIN_CHECK|Detected redirect: https://channels.weixin.qq.com/platform -> https://channels.weixin.qq.com/platform/login.html
WECHAT_LOGIN_CHECK|  page[0] url=https://channels.weixin.qq.com/platform/login.html
WECHAT_LOGIN_CHECK|Initial browser state=login details=[{"index":0,"url":"https://channels.weixin.qq.com/platform/login.html","login_url":true,"dashboard_url":false,"login_ui":true,"dashboard_ui":false}]
WECHAT_LOGIN_CHECK|On login page — QR scan needed
WECHAT_LOGIN_CHECK|QR code saved to: /path/to/temp_qrcode.png
[LoginStatus] 账号 account_xxx 状态: need_login (首次检测: true, 状态变化: false)
[LoginStatus] 发送飞书通知: account_xxx 无 -> need_login
[Feishu] sendLoginAlert 被调用: {accountId:'account_xxx',status:'need_login',mode:'app',hasQrCodePath:true,hasReceiveId:true}
[Feishu] 准备上传并发送二维码图片... {qrCodePath:'/path/to/temp_qrcode.png',receiveIdType:'chat_id',receiveId:'oc_xxx'}
[Feishu] 图片上传成功: img_xxx
[Feishu] 图片上传成功，准备发送...
[Feishu] 图片消息发送成功
[Feishu] 二维码图片已发送
[Feishu] 准备发送卡片消息...
[Feishu] 卡片消息发送成功
[Feishu] 卡片消息发送结果: { success: true }
```

### 成功的检测流程（已登录）

```
WECHAT_LOGIN_CHECK|Starting login check for account_xxx (headed)
WECHAT_LOGIN_CHECK|Navigating to channels platform...
WECHAT_LOGIN_CHECK|  page[0] url=https://channels.weixin.qq.com/platform/home
WECHAT_LOGIN_CHECK|Initial browser state=dashboard details=[{"index":0,"url":"https://channels.weixin.qq.com/platform/home","login_url":false,"dashboard_url":true,"login_ui":false,"dashboard_ui":true}]
WECHAT_LOGIN_CHECK|Already logged in — session cookies are valid!
[LoginStatus] 账号 account_xxx 状态: logged_in (首次检测: true, 状态变化: false)
[LoginStatus] 跳过通知: account_xxx 无 -> logged_in
```
