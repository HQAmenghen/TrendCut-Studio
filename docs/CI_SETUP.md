# CI/CD 配置文档

## 概述

本项目配置了最小但完整的 CI/CD 流程，确保代码质量和构建稳定性。

## CI 配置

### 1. GitHub Actions (`.github/workflows/ci.yml`)

适用于 GitHub 托管的项目。

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支

**检查项：**
- 单元测试（Node.js 18.x, 20.x, 22.x）
- 前端构建
- 代码风格检查
- 测试覆盖率上传（Codecov）

### 2. Gitee Go (`.gitee/workflows/ci.yml`)

适用于 Gitee 托管的项目（当前使用）。

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支

**检查项：**
- 单元测试（Node.js 18.x, 20.x）
- 前端构建
- 代码风格检查

## 本地 CI

### 1. 完整 CI 检查

在提交前运行完整的 CI 检查：

```bash
npm run ci
```

**检查项：**
1. 运行单元测试
2. 构建前端
3. 代码风格检查

### 2. 单独运行各项检查

```bash
# 运行测试
npm test

# 运行测试（watch 模式）
npm run test:watch

# 运行测试并生成覆盖率报告
npm run test:coverage

# 代码风格检查
npm run lint

# 自动修复代码风格问题
npm run lint:fix

# 构建前端
npm run build:front
```

## Git Hooks

### 自动安装

项目在 `npm install` 后会自动安装 Git hooks。

### 手动安装

```bash
npm run install-hooks
```

### Pre-commit Hook

在每次 `git commit` 前自动运行：
- 单元测试

**跳过 hook：**
```bash
git commit --no-verify
```

## 代码风格

### ESLint 配置

项目使用 ESLint 进行代码风格检查，配置文件：`.eslintrc.js`

**规则：**
- 基于 `eslint:recommended`
- 允许 console 输出
- 未使用变量警告（以 `_` 开头的除外）
- 缩进：2 空格
- 引号：单引号
- 分号：必需

**忽略文件：**
- `node_modules/`
- `dist/`
- `public/`
- `coverage/`
- `data/`
- `python/`

### 自动修复

```bash
npm run lint:fix
```

## 测试

### Jest 配置

项目使用 Jest 进行单元测试，配置在 `package.json` 中。

**测试文件位置：**
- `server/**/__tests__/**/*.test.js`

**覆盖率收集：**
- 收集 `server/**/*.js` 的覆盖率
- 忽略 `node_modules/` 和 `__tests__/`

### 运行测试

```bash
# 运行所有测试
npm test

# Watch 模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

## CI 工作流程

### 开发流程

```
1. 开发功能
   ↓
2. 本地运行测试 (npm test)
   ↓
3. 本地运行 CI (npm run ci)
   ↓
4. 提交代码 (git commit)
   ├─ 自动运行 pre-commit hook
   └─ 测试通过 → 提交成功
   ↓
5. 推送到远程 (git push)
   ↓
6. 触发 CI/CD 流水线
   ├─ 运行单元测试
   ├─ 构建前端
   └─ 代码风格检查
   ↓
7. CI 通过 → 合并到主分支
```

### 持续集成流程

```
Push/PR → Gitee Go
           ↓
       检出代码
           ↓
       安装依赖 (npm ci)
           ↓
       运行测试 (npm test)
           ↓
       构建前端 (npm run build:front)
           ↓
       代码检查 (npm run lint)
           ↓
       ✓ 所有检查通过
```

## 最佳实践

### 1. 提交前检查

**推荐：**
```bash
npm run ci
```

这会运行完整的 CI 检查，确保代码质量。

### 2. 频繁运行测试

在开发过程中使用 watch 模式：
```bash
npm run test:watch
```

### 3. 保持测试覆盖率

目标：
- 核心模块覆盖率 > 80%
- 整体覆盖率 > 60%

查看覆盖率：
```bash
npm run test:coverage
```

### 4. 修复代码风格

在提交前自动修复：
```bash
npm run lint:fix
```

### 5. 小步提交

- 每个提交只做一件事
- 提交信息清晰明确
- 确保每个提交都能通过 CI

## 故障排查

### 1. Git Hook 未运行

**问题：** 提交时没有运行测试

**解决：**
```bash
npm run install-hooks
```

### 2. ESLint 报错

**问题：** 代码风格检查失败

**解决：**
```bash
# 查看具体错误
npm run lint

# 自动修复
npm run lint:fix
```

### 3. 测试失败

**问题：** 单元测试失败

**解决：**
```bash
# 运行测试查看详细错误
npm test

# Watch 模式调试
npm run test:watch
```

### 4. 前端构建失败

**问题：** `npm run build:front` 失败

**解决：**
```bash
# 检查依赖
npm install

# 清理缓存
rm -rf node_modules/.vite
npm run build:front
```

## 配置文件

### CI 配置
- `.github/workflows/ci.yml` - GitHub Actions 配置
- `.gitee/workflows/ci.yml` - Gitee Go 配置

### 代码质量
- `.eslintrc.js` - ESLint 配置
- `.eslintignore` - ESLint 忽略文件

### 测试
- `package.json` (jest 字段) - Jest 配置

### 脚本
- `scripts/ci.js` - 本地 CI 脚本
- `scripts/install-hooks.js` - Git hooks 安装脚本
- `.git/hooks/pre-commit` - Pre-commit hook

## 扩展

### 添加新的 CI 检查

编辑 `scripts/ci.js`，在 `steps` 数组中添加新步骤：

```javascript
{
  name: '4. 新检查',
  command: 'npm',
  args: ['run', 'new-check'],
  required: true
}
```

### 添加新的 Git Hook

编辑 `scripts/install-hooks.js`，在 `hooks` 数组中添加新 hook：

```javascript
{
  name: 'pre-push',
  content: prePushHook
}
```

### 自定义 ESLint 规则

编辑 `.eslintrc.js`，在 `rules` 中添加或修改规则：

```javascript
rules: {
  'no-console': 'warn',
  'prefer-const': 'error'
}
```

## 参考资料

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Gitee Go 文档](https://gitee.com/help/articles/4193)
- [ESLint 文档](https://eslint.org/docs/latest/)
- [Jest 文档](https://jestjs.io/docs/getting-started)
