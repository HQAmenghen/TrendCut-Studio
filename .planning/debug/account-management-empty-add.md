---
status: resolved
trigger: "账号管理页面点击添加时没有输入任何消息也能添加账号，而且账号配置和删除账号选项没有进行相应修改。"
created: "2026-05-29T15:45:20+08:00"
updated: "2026-05-29T15:53:53+08:00"
---

# Debug Session: account-management-empty-add

## Symptoms

- Expected behavior: 添加账号必须填写必要信息；空输入不能创建账号；账号配置和删除账号操作应随着账号管理能力一起可用并保持一致。
- Actual behavior: 在账号管理页面点击添加，没有输入任何消息也能添加账号；管理/删除相关选项没有同步修改。
- Error messages: 无明确错误提示。
- Timeline: 用户在账号管理页面使用“添加配置/添加账号”时发现。
- Reproduction: 打开账号管理页面，点击添加入口，不填写内容直接确认添加。

## Current Focus

- hypothesis: 账号管理面板直接调用 add*Account 创建空账号草稿，缺少必填校验；后端 normalize 也会保留空账号行。
- test: 已检查 AutomationDashboard 账号管理、usePublishCenter 账号工厂/保存流程、publishStore.config 账号清洗逻辑。
- expecting: 添加账号必须先填写平台必填字段；配置/删除可在账号管理面板操作；后端不持久化空账号行。
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-29T15:49:00+08:00
  observation: `frontend/src/components/AutomationDashboard.vue` 的账号管理按钮直接调用 `addAccountConfig()`，该函数再直接调用 `publishCenter.addWechatAccount/addSauAccount/addXAccount`，没有表单输入或必填校验。
  result: confirmed
- timestamp: 2026-05-29T15:49:30+08:00
  observation: `frontend/src/components/AutomationDashboard.vue` 的账号行只有检测和“管理”内容页入口，没有账号配置编辑或删除入口；X 账号还没有内容管理入口。
  result: confirmed
- timestamp: 2026-05-29T15:50:30+08:00
  observation: `server/services/publish/publishStore.config.js` 的账号 sanitize 流程原本会为传入的空对象生成账号 ID 并保留空字段。
  result: confirmed

## Eliminated

## Resolution

- root_cause: 自动化看板账号管理把“添加”实现为直接创建空账号草稿，并且后端发布配置归一化没有过滤空账号行，导致空输入也能形成账号配置。
- fix: 添加账号配置弹窗和必填校验，账号行补齐配置/删除操作；账号工厂支持带初始值创建；后端保存时过滤无有效身份/授权字段的空账号行。
- verification: `npm test -- server/services/publish/__tests__/publishStore.config.test.js`; `npm run lint`; `npm run build:front`; `Invoke-WebRequest http://127.0.0.1:5173/` 返回 200（Node Playwright 未安装，无法执行浏览器点击自动化）。
- files_changed: `frontend/src/components/AutomationDashboard.vue`, `frontend/src/composables/usePublishCenter.js`, `server/services/publish/publishStore.config.js`, `server/services/publish/__tests__/publishStore.config.test.js`
