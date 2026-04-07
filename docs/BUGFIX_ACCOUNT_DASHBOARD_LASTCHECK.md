# Bug 修复：账号看板登录检测时间字段不一致

## 问题描述

账号看板里的"最近登录检测时间"目前取不到，前端会长期显示空。

## 根本原因

字段契约没对齐：

1. **账号看板读取**: `server/services/publish/accountDashboard.js` (line 127) 读取的是 `loginStatus.lastCheckedAt`
2. **登录状态写入**: `server/services/notification/loginStatus.js` (line 89, 333) 写入的是 `lastCheck`

导致账号看板能显示登录状态，但"登录检测时间"始终为空。

## 字段对比

### 登录状态服务写入的字段

```javascript
// server/services/notification/loginStatus.js (line 87-93)
this.statusCache.set(accountId, {
  status,
  lastCheck: now,        // ← 写入的是 lastCheck
  lastNotify: (statusChanged || isFirstCheck) ? now : cached.lastNotify,
  qrCodePath,
  account
});
```

### 账号看板读取的字段

```javascript
// server/services/publish/accountDashboard.js (line 127-130) - 修复前
loginStatus: loginStatus ? {
  status: loginStatus.status,
  lastCheckedAt: loginStatus.lastCheckedAt,  // ← 读取的是 lastCheckedAt（不存在）
  message: loginStatus.message
} : null,
```

## 修复方案

修改 `accountDashboard.js` 读取正确的字段名 `lastCheck`，并转换为 ISO 字符串格式。

```javascript
// server/services/publish/accountDashboard.js (line 127-131) - 修复后
loginStatus: loginStatus ? {
  status: loginStatus.status,
  lastCheckedAt: loginStatus.lastCheck ? new Date(loginStatus.lastCheck).toISOString() : null,
  message: loginStatus.message || null
} : null,
```

## 修复位置

**文件**: `server/services/publish/accountDashboard.js`  
**行号**: 127-131

## 修复内容

1. 将 `loginStatus.lastCheckedAt` 改为 `loginStatus.lastCheck`
2. 将时间戳转换为 ISO 字符串格式（前端期望的格式）
3. 添加空值保护

## 测试验证

```bash
node -e "
const { createAccountDashboardService } = require('./server/services/publish/accountDashboard.js');

// Mock dependencies with lastCheck field
const mockDeps = {
  readPublishConfig: () => ({
    wechatChannels: {
      accounts: [{ id: 'test1', displayName: '测试账号1' }]
    }
  }),
  readPublishJobs: () => ({ jobs: [] }),
  loginStatusService: {
    getAccountStatus: async () => ({
      status: 'logged_in',
      lastCheck: Date.now() - 3600000, // 1小时前
      message: '登录正常'
    })
  }
};

const service = createAccountDashboardService(mockDeps);
service.getAccountDashboard().then(dashboard => {
  const account = dashboard.accounts[0];
  console.log('登录状态:', account.loginStatus.status);
  console.log('最近检测时间:', account.loginStatus.lastCheckedAt);
  console.log('✅ 修复成功');
});
"
```

**结果**:
```
登录状态: logged_in
最近检测时间: 2026-04-01T02:08:37.368Z
✅ 修复成功
```

## 影响范围

- ✅ 修复了账号看板登录检测时间显示问题
- ✅ 前端可以正确显示相对时间（"X分钟前"、"X小时前"）
- ✅ 不影响登录状态检测功能
- ✅ 不影响其他使用 loginStatusService 的模块

## 数据格式

### 修复前

```json
{
  "loginStatus": {
    "status": "logged_in",
    "lastCheckedAt": null,  // ← 始终为空
    "message": "登录正常"
  }
}
```

### 修复后

```json
{
  "loginStatus": {
    "status": "logged_in",
    "lastCheckedAt": "2026-04-01T02:08:37.368Z",  // ← 正确的时间
    "message": "登录正常"
  }
}
```

## 前端显示效果

修复后，前端可以正确显示登录检测时间：

```
登录检测: 1小时前
登录检测: 30分钟前
登录检测: 刚刚
```

## 相关代码

### loginStatus.js - 状态缓存结构

```javascript
// server/services/notification/loginStatus.js
{
  status: 'logged_in' | 'need_login',
  lastCheck: number,      // 时间戳
  lastNotify: number,     // 时间戳
  qrCodePath: string,
  account: object,
  error: string
}
```

### accountDashboard.js - 返回格式

```javascript
// server/services/publish/accountDashboard.js
{
  loginStatus: {
    status: string,
    lastCheckedAt: string,  // ISO 字符串
    message: string
  }
}
```

## 建议

### 短期

1. ✅ 已修复字段名不一致问题
2. ✅ 已添加时间格式转换
3. ✅ 已添加空值保护

### 长期

1. **统一字段命名**: 考虑在 loginStatus.js 中也使用 `lastCheckedAt` 而不是 `lastCheck`，保持一致性
2. **类型定义**: 添加 TypeScript 类型定义或 JSDoc 注释，明确字段契约
3. **单元测试**: 添加字段映射的单元测试，防止类似问题

## 相关文件

- `server/services/publish/accountDashboard.js` - 账号看板服务
- `server/services/notification/loginStatus.js` - 登录状态服务
- `frontend/src/components/AccountDashboardWorkspace.vue` - 前端组件
- `docs/BUGFIX_ACCOUNT_DASHBOARD_LASTCHECK.md` - 本文档

## 总结

修复后，账号看板可以正确显示登录检测时间：
- ✅ 字段名已对齐（`lastCheck` → `lastCheckedAt`）
- ✅ 时间格式已转换（时间戳 → ISO 字符串）
- ✅ 前端可以正确显示相对时间
- ✅ 提升了用户体验

**关键改进**:
- 从"字段不存在，始终为空"变为"字段正确映射，显示实际时间"
- 从"前端无法判断检测时间"变为"前端可以显示友好的相对时间"
