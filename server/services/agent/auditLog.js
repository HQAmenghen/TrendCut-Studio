const fs = require('fs');
const path = require('path');

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return JSON.stringify({ error: 'unserializable' });
  }
}

function redactSecrets(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api[_-]?key/i.test(key)) {
      next[key] = item ? '[redacted]' : item;
    } else if (item && typeof item === 'object') {
      next[key] = redactSecrets(item);
    } else {
      next[key] = item;
    }
  }
  return next;
}

function createAgentAuditLogger(options = {}) {
  const logPath = options.logPath;

  function append(entry) {
    if (!logPath) return;
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${safeJson({
        timestamp: new Date().toISOString(),
        ...entry,
        request: redactSecrets(entry.request || {}),
        response: redactSecrets(entry.response || {})
      })}\n`, 'utf8');
    } catch (err) {
      console.warn('[agent:audit] failed to write audit log:', err.message);
    }
  }

  function middleware(req, res, next) {
    const startedAt = Date.now();
    const chunks = [];
    const originalJson = res.json.bind(res);

    res.json = (payload) => {
      chunks.push(payload);
      return originalJson(payload);
    };

    res.on('finish', () => {
      append({
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        remoteAddress: req.ip || req.socket?.remoteAddress || '',
        request: {
          params: req.params || {},
          query: req.query || {},
          body: req.body || {}
        },
        response: chunks[0] || null
      });
    });

    return next();
  }

  return {
    append,
    middleware
  };
}

module.exports = {
  createAgentAuditLogger,
  redactSecrets
};
