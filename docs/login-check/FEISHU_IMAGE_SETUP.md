# 飞书发送二维码图片配置指南

## 功能说明

当检测到微信视频号账号掉登录时，系统会自动：
1. 捕获登录二维码图片
2. 通过飞书发送二维码图片和告警卡片

## 配置步骤

### 1. 创建飞书应用

由于飞书群机器人（Webhook）不支持发送图片，需要创建飞书应用来使用消息API。

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击"创建企业自建应用"
3. 填写应用名称和描述，上传应用图标
4. 创建完成后，进入应用详情页

### 2. 获取应用凭证

在应用详情页的"凭证与基础信息"中：
- 复制 `App ID`
- 复制 `App Secret`

### 3. 配置应用权限

在"权限管理"中，添加以下权限：
- `im:message` - 获取与发送单聊、群组消息
- `im:message:send_as_bot` - 以应用的身份发消息
- `im:resource` - 上传图片等资源

配置完成后，点击"发布版本"。

### 4. 获取群聊 chat_id

有两种方式获取群聊的 chat_id：

**方式1：通过群设置**
1. 在飞书客户端打开目标群聊
2. 点击右上角"..."，选择"设置"
3. 在群设置中找到"群机器人"
4. 添加刚创建的应用机器人
5. 添加后，在群设置的"群信息"中可以看到 chat_id（格式：oc_xxx）

**方式2：通过API获取**
```bash
# 先获取 tenant_access_token
curl -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "你的APP_ID",
    "app_secret": "你的APP_SECRET"
  }'

# 使用 token 获取群列表
curl -X GET https://open.feishu.cn/open-apis/im/v1/chats \
  -H "Authorization: Bearer 你的tenant_access_token"
```

### 5. 配置环境变量

在 `.env` 文件中添加以下配置：

```bash
# 飞书应用配置（用于发送图片）
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 接收消息的群聊ID
FEISHU_RECEIVE_ID_TYPE=chat_id
FEISHU_RECEIVE_ID=oc_xxx

# 可选：保留 Webhook 用于发送纯文本消息
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx

# 通知开关
FEISHU_NOTIFY_LOGIN_STATUS=true
```

### 6. 重启服务

```bash
npm run dev
```

## 配置说明

### 必需配置

- `FEISHU_APP_ID`: 飞书应用的 App ID
- `FEISHU_APP_SECRET`: 飞书应用的 App Secret
- `FEISHU_RECEIVE_ID`: 接收消息的目标ID（群聊ID或用户ID）

### 可选配置

- `FEISHU_RECEIVE_ID_TYPE`: 接收者ID类型，可选值：
  - `chat_id` - 群聊ID（默认）
  - `open_id` - 用户Open ID
  - `user_id` - 用户ID
  - `union_id` - 用户Union ID
  - `email` - 用户邮箱

- `FEISHU_WEBHOOK_URL`: 群机器人Webhook地址（可选，用于发送纯文本消息）

## 工作模式

系统支持两种工作模式：

### 应用模式（推荐）
- 配置了 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
- 支持发送图片、文本、卡片等所有消息类型
- 需要将应用机器人添加到目标群聊

### Webhook模式（仅文本）
- 仅配置了 `FEISHU_WEBHOOK_URL`
- 只支持发送文本和卡片消息
- 不支持发送图片

## 测试

配置完成后，可以通过以下方式测试：

1. 访问系统设置页面
2. 点击"测试飞书通知"按钮
3. 检查飞书群聊是否收到测试消息

或者手动触发登录检测：
```bash
curl -X POST http://localhost:3001/api/login-status/check-all
```

## 故障排查

### 1. 图片发送失败

检查：
- 应用是否有 `im:resource` 权限
- 应用是否已添加到目标群聊
- `FEISHU_RECEIVE_ID` 是否正确

### 2. 消息发送失败

检查：
- 应用是否有 `im:message` 和 `im:message:send_as_bot` 权限
- `tenant_access_token` 是否获取成功（查看服务日志）
- 应用版本是否已发布

### 3. 找不到二维码图片

检查：
- Python 环境是否正常
- Playwright 是否已安装：`python -m playwright install chromium`
- 临时文件目录是否有写入权限

## 注意事项

1. 应用模式需要将机器人添加到群聊后才能发送消息
2. 二维码图片会临时保存在项目根目录的 `temp_qrcode.png`
3. 图片上传到飞书后会获得一个 `image_key`，有效期为7天
4. 建议定期检查应用权限和版本状态
