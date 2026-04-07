const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(process.cwd(), 'data', 'logs', 'server.log');

const logBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER_SIZE = 50;

function ensureLogDir() {
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function flushLogBuffer() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (logBuffer.length === 0) return;

  const content = logBuffer.join('');
  logBuffer.length = 0;

  ensureLogDir();
  fs.appendFile(LOG_FILE, content, 'utf8', (err) => {
    if (err) {
      // 静默失败
    }
  });
}

function writeLog(message) {
  const timestamp = new Date().toISOString();
  logBuffer.push(`[${timestamp}] ${message}\n`);

  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    flushLogBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushLogBuffer, FLUSH_INTERVAL_MS);
  }
}

process.on('exit', () => {
  if (logBuffer.length > 0) {
    try {
      ensureLogDir();
      fs.appendFileSync(LOG_FILE, logBuffer.join(''), 'utf8');
    } catch (_err) {}
  }
});

process.on('SIGINT', () => {
  if (logBuffer.length > 0) {
    try {
      ensureLogDir();
      fs.appendFileSync(LOG_FILE, logBuffer.join(''), 'utf8');
    } catch (_err) {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (logBuffer.length > 0) {
    try {
      ensureLogDir();
      fs.appendFileSync(LOG_FILE, logBuffer.join(''), 'utf8');
    } catch (_err) {}
  }
  process.exit(0);
});

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
