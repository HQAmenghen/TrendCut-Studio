const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(process.cwd(), 'data', 'logs', 'server.log');

// 确保日志目录存在
function ensureLogDir() {
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// 写入日志到文件
function writeLog(message) {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`, 'utf8');
  } catch (err) {
    // 静默失败
  }
}

// 重写 console.log
const originalLog = console.log;
console.log = function(...args) {
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  writeLog(message);
  originalLog.apply(console, args);
};

// 重写 console.error
const originalError = console.error;
console.error = function(...args) {
  const message = '[ERROR] ' + args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  writeLog(message);
  originalError.apply(console, args);
};

// 重写 console.warn
const originalWarn = console.warn;
console.warn = function(...args) {
  const message = '[WARN] ' + args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  writeLog(message);
  originalWarn.apply(console, args);
};

module.exports = {
  LOG_FILE
};
