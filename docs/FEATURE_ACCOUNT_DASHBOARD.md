# 账号看板功能

## 功能概述

账号看板提供账号维度的统计和管理功能，帮助用户快速了解每个微信视频号账号的运行状态、任务统计和最近失败情况。

## 核心功能

### 1. 账号列表展示

显示所有配置的微信视频号账号，包括：
- 账号 ID
- 显示名称（displayName / helperAccount / finderUserName）
- Finder 用户名
- 辅助账号
- 启用状态（微信账号默认启用）

### 2. 登录状态监控

实时显示每个账号的登录状态：
- `logged_in` - 已登录
- `need_login` - 需要登录
- `checking` - 检测中
- `error` - 检测失败

包含最后检测时间和状态消息。

### 3. 任务统计

统计每个账号的任务数据：
- **总任务数**：该账号的所有任务
- **近 7 天任务数**：最近 7 天创建的任务
- **成功数**：近 7 天成功发布的任务
- **失败数**：近 7 天失败的任务
- **运行中**：当前正在执行的任务
- **最近发布时间**：最后一次成功发布的时间

### 4. 失败摘要

显示每个账号最近的失败任务：
- 失败时间
- 任务 ID 和标题
- 错误码和错误消息
- 排障建议
- 可重试判断

### 5. 汇总数据

提供全局汇总统计：
- 总账号数
- 已登录账号数
- 需要登录账号数
- 运行中任务总数
- 近 7 天成功总数
- 近 7 天失败总数

## API 接口

### 1. 获取账号看板

```http
GET /api/publish/accounts/dashboard
```

**响应示例**：

```json
{
  "success": true,
  "accounts": [
    {
      "id": "account1",
      "displayName": "测试账号1",
      "finderUserName": "test_user_1",
      "helperAccount": "helper@example.com",
      "enabled": true,
      "loginStatus": {
        "status": "logged_in",
        "lastCheckedAt": "2026-04-01T10:00:00.000Z",
        "message": "登录正常"
      },
      "stats": {
        "totalJobs": 50,
        "recentJobs": 10,
        "successCount": 8,
        "failureCount": 2,
        "runningCount": 1,
        "lastPublishedAt": "2026-04-01T09:30:00.000Z",
        "lastFailure": {
          "jobId": "job123",
          "jobTitle": "测试视频",
          "failedAt": "2026-03-31T15:00:00.000Z",
          "errorCode": "WECHAT_UPLOAD_FAILED",
          "errorMessage": "视频上传失败",
          "hint": "检查网络连接和视频文件大小"
        }
      }
    }
  ],
  "summary": {
    "totalAccounts": 5,
    "loggedInAccounts": 4,
    "needLoginAccounts": 1,
    "runningTasks": 3,
    "totalSuccessLast7Days": 45,
    "totalFailuresLast7Days": 5
  }
}
```

### 2. 获取账号任务列表

```http
GET /api/publish/accounts/:accountId/jobs?status=failed&limit=50
```

**查询参数**：
- `status` (可选) - 过滤任务状态
- `limit` (可选) - 限制返回数量，默认 50

**响应示例**：

```json
{
  "success": true,
  "jobs": [
    {
      "id": "job123",
      "createdAt": "2026-04-01T08:00:00.000Z",
      "platformTasks": [
        {
          "platform": "wechatChannels",
          "accountId": "account1",
          "status": "published"
        }
      ]
    }
  ]
}
```

### 3. 获取账号失败任务

```http
GET /api/publish/accounts/:accountId/failures?limit=20
```

**查询参数**：
- `limit` (可选) - 限制返回数量，默认 20

**响应示例**：

```json
{
  "success": true,
  "jobs": [
    {
      "id": "job123",
      "createdAt": "2026-03-31T15:00:00.000Z",
      "platformTasks": [
        {
          "platform": "wechatChannels",
          "accountId": "account1",
          "status": "failed",
          "failureSummary": {
            "failedAt": "2026-03-31T15:00:00.000Z",
            "errorCode": "WECHAT_UPLOAD_FAILED",
            "errorMessage": "视频上传失败"
          }
        }
      ]
    }
  ]
}
```

## 数据结构

### AccountStats

```typescript
interface AccountStats {
  totalJobs: number;           // 总任务数
  recentJobs: number;          // 近 7 天任务数
  successCount: number;        // 近 7 天成功数
  failureCount: number;        // 近 7 天失败数
  runningCount: number;        // 运行中任务数
  lastPublishedAt: string | null;  // 最近发布时间
  lastFailure: FailureSummary | null;  // 最近失败摘要
}
```

### AccountData

```typescript
interface AccountData {
  id: string;                  // 账号 ID
  displayName: string;         // 显示名称
  finderUserName: string;      // Finder 用户名
  helperAccount: string;       // 辅助账号
  enabled: boolean;            // 启用状态
  loginStatus: LoginStatus | null;  // 登录状态
  stats: AccountStats;         // 统计数据
}
```

### DashboardSummary

```typescript
interface DashboardSummary {
  totalAccounts: number;           // 总账号数
  loggedInAccounts: number;        // 已登录账号数
  needLoginAccounts: number;       // 需要登录账号数
  runningTasks: number;            // 运行中任务总数
  totalSuccessLast7Days: number;   // 近 7 天成功总数
  totalFailuresLast7Days: number;  // 近 7 天失败总数
}
```

## 实现细节

### 后端服务

**文件位置**：`server/services/publish/accountDashboard.js`

**核心函数**：

1. `getAccountStats(accountId, jobs)` - 计算单个账号的统计数据
   - 过滤该账号的所有任务
   - 统计近 7 天的成功和失败数
   - 统计运行中的任务
   - 记录最近发布时间和最近失败

2. `getAccountDashboard()` - 获取所有账号的看板数据
   - 读取发布配置获取账号列表
   - 读取发布任务数据
   - 调用 loginStatusService 获取登录状态
   - 为每个账号计算统计数据
   - 生成汇总数据

3. `getAccountJobs(accountId, options)` - 获取账号的任务列表
   - 支持按状态过滤
   - 支持限制返回数量

4. `getAccountFailedJobs(accountId, limit)` - 获取账号的失败任务
   - 快捷方式，等同于 `getAccountJobs(accountId, { status: 'failed', limit })`

### 路由注册

**文件位置**：`server/routes/publish.js`

添加了三个新路由：
- `GET /api/publish/accounts/dashboard`
- `GET /api/publish/accounts/:accountId/jobs`
- `GET /api/publish/accounts/:accountId/failures`

### 服务集成

**文件位置**：`server.js`

1. 导入 accountDashboard 服务
2. 在 loginStatusService 之后创建 accountDashboardService
3. 将 accountDashboardService 注入到 publishHandlers

## 使用场景

### 1. 监控账号健康度

通过账号看板快速了解：
- 哪些账号需要重新登录
- 哪些账号最近失败率高
- 哪些账号运行正常

### 2. 排查问题

当某个账号出现问题时：
- 查看最近失败摘要
- 获取失败任务列表
- 根据排障建议修复问题

### 3. 容量规划

通过统计数据了解：
- 各账号的任务分布
- 成功率和失败率
- 是否需要增加账号

## 前端集成（待实现）

### 推荐 UI 布局

```
┌─────────────────────────────────────────────────────┐
│ 账号看板                                              │
├─────────────────────────────────────────────────────┤
│ 汇总统计                                              │
│ 总账号: 5  已登录: 4  需登录: 1  运行中: 3            │
│ 近7天成功: 45  失败: 5                                │
├─────────────────────────────────────────────────────┤
│ 账号列表                                              │
│                                                       │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 测试账号1                    [已登录] [运行中:1] │ │
│ │ test_user_1                                     │ │
│ │ 近7天: 成功 8 / 失败 2                           │ │
│ │ 最近发布: 2026-04-01 09:30                      │ │
│ │ 最近失败: 视频上传失败 (2026-03-31 15:00)       │ │
│ └─────────────────────────────────────────────────┘ │
│                                                       │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 测试账号2                    [需登录] [运行中:0] │ │
│ │ test_user_2                                     │ │
│ │ 近7天: 成功 10 / 失败 0                          │ │
│ │ 最近发布: 2026-04-01 08:00                      │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 推荐功能

1. **账号卡片**
   - 显示账号基本信息
   - 登录状态徽章
   - 运行中任务数徽章
   - 成功/失败统计
   - 最近发布时间
   - 最近失败摘要（如果有）

2. **交互功能**
   - 点击账号卡片展开详情
   - 查看该账号的所有任务
   - 查看该账号的失败任务
   - 快速跳转到登录页面

3. **筛选和排序**
   - 按登录状态筛选
   - 按失败率排序
   - 按最近活跃时间排序

## 测试验证

### 单元测试

```bash
node -e "
const { createAccountDashboardService } = require('./server/services/publish/accountDashboard.js');

// Mock dependencies
const mockDeps = {
  readPublishConfig: () => ({
    wechatChannels: {
      accounts: [
        { id: 'test1', displayName: '测试账号1' }
      ]
    }
  }),
  readPublishJobs: () => ({ jobs: [] }),
  loginStatusService: {
    getAccountStatus: async () => ({
      status: 'logged_in',
      lastCheckedAt: new Date().toISOString()
    })
  }
};

const service = createAccountDashboardService(mockDeps);
service.getAccountDashboard().then(dashboard => {
  console.log('✅ 测试通过');
  console.log('账号数量:', dashboard.accounts.length);
});
"
```

### API 测试

启动服务后，使用 curl 测试：

```bash
# 获取账号看板
curl http://localhost:3001/api/publish/accounts/dashboard

# 获取账号任务列表
curl http://localhost:3001/api/publish/accounts/account1/jobs?limit=10

# 获取账号失败任务
curl http://localhost:3001/api/publish/accounts/account1/failures?limit=5
```

## 相关文件

- `server/services/publish/accountDashboard.js` - 账号看板服务
- `server/routes/publish.js` - 路由注册
- `server/services/publish/handlers.js` - 路由处理器
- `server.js` - 服务集成
- `docs/FEATURE_ACCOUNT_DASHBOARD.md` - 本文档

## 后续优化

### 短期

1. **前端实现**
   - 创建账号看板 Vue 组件
   - 集成到导航菜单
   - 实现账号卡片和详情页

2. **数据缓存**
   - 缓存账号统计数据
   - 定期刷新缓存
   - 减少计算开销

### 长期

1. **账号健康度评分**
   - 基于成功率、失败率、活跃度计算健康度
   - 提供健康度趋势图

2. **告警功能**
   - 账号登录失效告警
   - 失败率过高告警
   - 长时间未活跃告警

3. **账号分组**
   - 支持账号分组管理
   - 按分组统计数据

4. **历史趋势**
   - 记录账号历史统计数据
   - 显示成功率趋势图
   - 显示任务量趋势图

## 总结

账号看板功能提供了账号维度的可视性，帮助用户：
- ✅ 快速了解账号状态
- ✅ 监控账号健康度
- ✅ 排查账号问题
- ✅ 优化账号使用

后端 API 已完成实现和测试，前端 UI 待实现。
