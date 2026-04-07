#!/usr/bin/env node

/**
 * 安装 Git hooks
 *
 * 使用方法：
 *   node scripts/install-hooks.js
 *   npm run install-hooks
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const HOOKS_DIR = path.join(PROJECT_ROOT, '.git', 'hooks');

const preCommitHook = `#!/bin/sh

# Git pre-commit hook
# 在提交前运行测试，确保代码质量

echo "🔍 运行 pre-commit 检查..."

# 运行测试
echo ""
echo "▶ 运行单元测试..."
npm test
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ 测试失败，提交被阻止"
  echo "请修复测试后再提交，或使用 git commit --no-verify 跳过检查"
  exit 1
fi

echo ""
echo "✅ 所有检查通过"
exit 0
`;

function installHook(hookName, content) {
  const hookPath = path.join(HOOKS_DIR, hookName);

  try {
    // 检查 .git/hooks 目录是否存在
    if (!fs.existsSync(HOOKS_DIR)) {
      console.error('❌ .git/hooks 目录不存在，请确保在 Git 仓库中运行此脚本');
      return false;
    }

    // 写入 hook 文件
    fs.writeFileSync(hookPath, content, { mode: 0o755 });

    // Windows 上需要额外处理权限
    if (process.platform === 'win32') {
      console.log(`✓ 已安装 ${hookName} (Windows)`);
    } else {
      // Unix-like 系统设置可执行权限
      fs.chmodSync(hookPath, 0o755);
      console.log(`✓ 已安装 ${hookName}`);
    }

    return true;
  } catch (err) {
    console.error(`❌ 安装 ${hookName} 失败:`, err.message);
    return false;
  }
}

function main() {
  console.log('\n===========================================');
  console.log('       安装 Git Hooks');
  console.log('===========================================\n');

  const hooks = [
    { name: 'pre-commit', content: preCommitHook }
  ];

  let allSuccess = true;

  for (const hook of hooks) {
    if (!installHook(hook.name, hook.content)) {
      allSuccess = false;
    }
  }

  console.log('\n===========================================\n');

  if (allSuccess) {
    console.log('✅ 所有 Git hooks 安装成功！');
    console.log('\n提示：');
    console.log('  - 提交代码时会自动运行测试');
    console.log('  - 使用 git commit --no-verify 可跳过检查');
    console.log('  - 使用 npm run ci 可手动运行完整检查\n');
  } else {
    console.log('❌ 部分 Git hooks 安装失败\n');
    process.exit(1);
  }
}

main();
