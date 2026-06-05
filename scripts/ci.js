#!/usr/bin/env node

/**
 * 本地 CI 脚本
 * 在提交代码前运行，确保代码质量
 *
 * 使用方法：
 *   node scripts/ci.js
 *   npm run ci
 */

const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command, args, options = {}) {
  const startTime = Date.now();
  log(`\n▶ 运行: ${command} ${args.join(' ')}`, 'cyan');

  const result = spawnSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
    ...options
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (result.status === 0) {
    log(`✓ 成功 (${duration}s)`, 'green');
    return true;
  } else {
    log(`✗ 失败 (退出码: ${result.status}, ${duration}s)`, 'red');
    return false;
  }
}

function main() {
  log('\n===========================================', 'blue');
  log('       本地 CI 检查开始', 'blue');
  log('===========================================\n', 'blue');

  const steps = [
    {
      name: '1. 检查 legacy Express 边界',
      command: 'npm',
      args: ['run', 'check:legacy-boundary'],
      required: true
    },
    {
      name: '2. 检查 NestJS BFF 编译',
      command: 'npm',
      args: ['run', 'check:bff'],
      required: true
    },
    {
      name: '3. 检查 FastAPI 源码编译',
      command: 'npm',
      args: ['run', 'check:api'],
      required: true
    },
    {
      name: '4. 运行单元测试',
      command: 'npm',
      args: ['test'],
      required: true
    },
    {
      name: '5. 运行 Python 单元测试',
      command: 'npm',
      args: ['run', 'test:py'],
      required: true
    },
    {
      name: '6. 构建前端',
      command: 'npm',
      args: ['run', 'build:front'],
      required: true
    },
    {
      name: '7. 代码风格检查',
      command: 'npm',
      args: ['run', 'lint'],
      required: true
    },
    {
      name: '8. 生产依赖安全审计',
      command: 'npm',
      args: ['run', 'audit:prod'],
      required: true
    },
    {
      name: '9. Python 依赖锁检查',
      command: 'npm',
      args: ['run', 'check:py-lock'],
      required: true
    }
  ];

  let allPassed = true;
  const results = [];

  for (const step of steps) {
    log(`\n${step.name}`, 'yellow');
    log('-------------------------------------------', 'yellow');

    const success = runCommand(step.command, step.args);

    results.push({
      name: step.name,
      success,
      required: step.required
    });

    if (!success && step.required) {
      allPassed = false;
      log(`\n✗ 必需步骤失败: ${step.name}`, 'red');
      break;
    }
  }

  // 打印总结
  log('\n===========================================', 'blue');
  log('       CI 检查结果', 'blue');
  log('===========================================\n', 'blue');

  for (const result of results) {
    const icon = result.success ? '✓' : '✗';
    const color = result.success ? 'green' : (result.required ? 'red' : 'yellow');
    const status = result.success ? '通过' : (result.required ? '失败' : '跳过');
    log(`${icon} ${result.name}: ${status}`, color);
  }

  log('\n===========================================\n', 'blue');

  if (allPassed) {
    log('✓ 所有检查通过！可以提交代码。', 'green');
    process.exit(0);
  } else {
    log('✗ 部分检查失败，请修复后再提交。', 'red');
    process.exit(1);
  }
}

// 捕获 Ctrl+C
process.on('SIGINT', () => {
  log('\n\n✗ CI 检查被中断', 'red');
  process.exit(1);
});

main();
