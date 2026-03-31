# 登录检测问题修复 - URL 判断和飞书通知

## 问题描述

1. **未登录的账号窗口不能关闭**：登录页面的 URL 是 `login.html`，但代码只检查 `/login`
2. **飞书没有转发二维码**：首次检测到需要登录时，没有发送飞书通知

## 问题分析

### 问题 1：URL 判断不准确

**原有代码：**
```python
def is_on_login_page(url: str) -> bool:
    return "channels.weixin.qq.com" in url and "/login" in url
```

**问题：**
- 只检查 `/login`，但实际的登录页面 URL 可能是 `login.html`
- 导致无法识别登录页面
- 状态被判断为 "unknown"
- 进入等待扫码的逻辑，但窗口不会关闭

### 问题 2：飞书通知逻辑不完整

**原有逻辑：**
```javascript
const statusChanged = cached.status && cached.status !== status;

if (statusChanged && notifyFeishu && this.notifyLoginStatus && this.feishuService) {
  await this.notifyStatusChange(account, status, cached.status, { qrCodePath });
}
```

**问题：**
- 只在"状态变化"时发送通知
- 首次检测的账号，`cached.status` 为空，`statusChanged` 为 false
- 即使检测到需要登录，也不会发送通知

**通知条件不完整：**
```javascript
const shouldNotify =
  (oldStatus === 'logged_in' && newStatus !== 'logged_in') ||
  (oldStatus !== 'logged_in' && newStatus === 'logged_in') ||
  (newStatus === 'error');
```

- 没有处理首次检测到需要登录的情况
- `oldStatus` 为空时，不会发送通知

## 解决方案

### 1. 修复 URL 判断

```python
def is_on_login_page(url: str) -> bool:
    return "channels.weixin.qq.com" in url and ("/login" in url or "login.html" in url)
```

**改进：**
- 同时检查 `/login` 和 `login.html`
- 兼容不同的 URL 格式
- 确保能正确识别登录页面

### 2. 增加首次检测的通知逻辑

```javascript
// 更新缓存
const cached = this.statusCache.get(accountId) || {};
const statusChanged = cached.status && cached.status !== status;
const isFirstCheck = !cached.status;  // 首次检测

this.statusCache.set(accountId, {
  status,
  lastCheck: now,
  lastNotify: (statusChanged || isFirstCheck) ? now : cached.lastNotify,
  qrCodePath,
  account
});

console.log(`[LoginStatus] 账号 ${accountId} 状态: ${status} (首次检测: ${isFirstCheck}, 状态变化: ${statusChanged})`);

// 如果状态变化、首次检测到需要登录、或允许通知，发送通知
const shouldNotify = notifyFeishu && this.notifyLoginStatus && this.feishuService;
const needNotify = statusChanged || (isFirstCheck && status === 'need_login');

if (shouldNotify && needNotify) {
  await this.notifyStatusChange(account, status, cached.status, { qrCodePath });
}
```

**改进：**
- 增加 `isFirstCheck` 标志，判断是否首次检测
- 首次检测到需要登录时，也会发送通知
- 更新 `lastNotify` 时间戳

### 3. 完善通知条件判断

```javascript
async notifyStatusChange(account, newStatus, oldStatus, details = {}) {
  // 通知条件：
  // 1. 状态恶化：logged_in -> need_login/error
  // 2. 状态恢复：need_login/error -> logged_in
  // 3. 首次检测到需要登录：oldStatus 为空且 newStatus 为 need_login
  // 4. 检测异常：newStatus 为 error
  const shouldNotify =
    (oldStatus === 'logged_in' && newStatus !== 'logged_in') ||
    (oldStatus !== 'logged_in' && newStatus === 'logged_in') ||
    (!oldStatus && newStatus === 'need_login') ||  // 首次检测到需要登录
    (newStatus === 'error');

  if (!shouldNotify) {
    console.log(`[LoginStatus] 跳过通知: ${account.id} ${oldStatus || '无'} -> ${newStatus}`);
    return;
  }

  console.log(`[LoginStatus] 发送飞书通知: ${account.id} ${oldStatus || '无'} -> ${newStatus}`);

  await this.feishuService.sendLoginAlert(account, newStatus, {
    ...details,
    loginUrl: `http://localhost:3001`,
    oldStatus,
    receiveIdType: this.feishuReceiveIdType,
    receiveId: this.feishuReceiveId
  });
}
```

**改进：**
- 增加首次检测到需要登录的条件：`!oldStatus && newStatus === 'need_login'`
- 增加详细的日志输出，方便调试
- 处理 `oldStatus` 为空的情况

## 通知场景

### 场景 1：首次检测到需要登录
```
oldStatus: 无
newStatus: need_login
结果: ✓ 发送通知（包含二维码）
```

### 场景 2：状态恶化（已登录 → 需要登录）
```
oldStatus: logged_in
newStatus: need_login
结果: ✓ 发送通知（包含二维码）
```

### 场景 3：状态恢复（需要登录 → 已登录）
```
oldStatus: need_login
newStatus: logged_in
结果: ✓ 发送通知
```

### 场景 4：检测异常
```
oldStatus: 任意
newStatus: error
结果: ✓ 发送通知
```

### 场景 5：首次检测已登录
```
oldStatus: 无
newStatus: logged_in
结果: ✗ 不发送通知（正常状态）
```

### 场景 6：状态未变化
```
oldStatus: need_login
newStatus: need_login
结果: ✗ 不发送通知（避免重复）
```

## 测试步骤

### 测试 1：未登录账号的检测

1. 使用未登录的账号
2. 点击"检测登录"
3. 预期结果：
   - 浏览器打开
   - 识别为登录页面（URL 包含 `login.html`）
   - 显示二维码
   - 如果启用飞书通知，会发送包含二维码的消息
   - 等待扫码或超时后关闭

### 测试 2：首次检测的飞书通知

1. 清除账号的状态缓存
2. 使用未登录的账号
3. 启用飞书通知
4. 点击"检测登录"
5. 预期结果：
   - 检测到需要登录
   - 发送飞书通知（包含二维码图片）
   - 飞书群聊收到消息

### 测试 3：状态变化的飞书通知

1. 账号原本是已登录状态
2. 手动退出登录
3. 定时检测触发
4. 预期结果：
   - 检测到状态变化（logged_in → need_login）
   - 发送飞书通知（包含二维码图片）
   - 飞书群聊收到消息

## 日志输出

### 首次检测到需要登录
```
[LoginStatus] 账号 account_xxx 状态: need_login (首次检测: true, 状态变化: false)
[LoginStatus] 发送飞书通知: account_xxx 无 -> need_login
[Feishu] 准备上传并发送二维码图片...
[Feishu] 图片上传成功: img_xxx
[Feishu] 二维码图片已发送
[Feishu] 卡片消息发送成功
```

### 状态变化
```
[LoginStatus] 账号 account_xxx 状态: need_login (首次检测: false, 状态变化: true)
[LoginStatus] 发送飞书通知: account_xxx logged_in -> need_login
[Feishu] 准备上传并发送二维码图片...
[Feishu] 图片上传成功: img_xxx
[Feishu] 二维码图片已发送
[Feishu] 卡片消息发送成功
```

### 跳过通知
```
[LoginStatus] 账号 account_xxx 状态: logged_in (首次检测: true, 状态变化: false)
[LoginStatus] 跳过通知: account_xxx 无 -> logged_in
```

## 配置检查

### 确认飞书配置正确

```bash
# .env 文件
FEISHU_APP_ID=cli_xxx                    # 飞书应用 ID
FEISHU_APP_SECRET=xxx                    # 飞书应用密钥
FEISHU_RECEIVE_ID_TYPE=chat_id           # 接收者类型
FEISHU_RECEIVE_ID=oc_xxx                 # 群聊 ID
FEISHU_NOTIFY_LOGIN_STATUS=true          # 启用登录状态通知
```

### 确认应用权限

飞书应用需要以下权限：
- `im:message` - 发送消息
- `im:message:send_as_bot` - 以应用身份发消息
- `im:resource` - 上传图片资源

### 确认机器人已添加到群聊

1. 在飞书群聊中添加应用机器人
2. 确认机器人在群成员列表中
3. 测试发送消息

## 故障排查

### 问题：仍然无法识别登录页面

1. 检查实际的 URL 格式
2. 在日志中查看 `url` 字段
3. 如果 URL 格式不同，更新 `is_on_login_page` 函数

### 问题：飞书通知仍然不发送

1. 检查日志中的通知条件判断
2. 确认 `notifyFeishu` 参数为 true
3. 确认 `FEISHU_NOTIFY_LOGIN_STATUS` 环境变量为 true
4. 检查飞书配置是否正确
5. 查看是否有错误日志

### 问题：二维码图片发送失败

1. 检查飞书应用权限
2. 确认 `im:resource` 权限已启用
3. 检查图片文件是否存在
4. 查看飞书 API 返回的错误信息

## 注意事项

1. **手动检测默认不发通知**：在发布中心手动点击"检测登录"时，`notifyFeishu` 默认为 false
2. **定时检测会发通知**：后台定时检测时，`notifyFeishu` 为 true
3. **避免重复通知**：状态未变化时不会重复发送通知
4. **首次检测特殊处理**：首次检测到需要登录时会发送通知，但首次检测到已登录不会发送
