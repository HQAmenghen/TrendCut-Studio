const { spawn, spawnSync } = require('child_process');
const path = require('path');

const PYTHON_PROTOCOL_PREFIX = '__CODEX_PYTHON__';

function createProtocolState() {
  return {
    events: [],
    result: null,
    error: null,
    lastStage: '',
    _stdoutBuffer: '',
    _stderrBuffer: ''
  };
}

function normalizeProtocolEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const type = String(event.type || '').trim();
  if (!type) return null;
  const normalized = { ...event, type };
  if (type === 'result') return normalized;
  if (type === 'error') {
    normalized.code = String(normalized.code || 'PYTHON_SCRIPT_FAILED');
    normalized.message = String(normalized.message || 'Python script failed');
    normalized.stage = String(normalized.stage || 'python');
    normalized.details = String(normalized.details || '');
    normalized.hint = String(normalized.hint || '');
    return normalized;
  }
  if (type === 'stage') {
    normalized.stage = String(normalized.stage || '');
    normalized.message = String(normalized.message || '');
    return normalized;
  }
  return normalized;
}

function registerProtocolEvent(state, event) {
  const normalized = normalizeProtocolEvent(event);
  if (!normalized) return;
  state.events.push(normalized);
  if (normalized.type === 'result') {
    state.result = normalized;
  } else if (normalized.type === 'error') {
    state.error = normalized;
  } else if (normalized.type === 'stage') {
    state.lastStage = normalized.stage || state.lastStage;
  }
}

function processVisibleLines(rawText, state) {
  const visibleLines = [];
  for (const line of rawText.split(/\r?\n/)) {
    if (!line.startsWith(PYTHON_PROTOCOL_PREFIX)) {
      visibleLines.push(line);
      continue;
    }
    const payloadText = line.slice(PYTHON_PROTOCOL_PREFIX.length);
    try {
      registerProtocolEvent(state, JSON.parse(payloadText));
    } catch (_err) {
      visibleLines.push(line);
    }
  }
  return visibleLines.join('\n');
}

function consumeProtocolChunk(state, streamKey, chunk) {
  const bufferKey = streamKey === 'stderr' ? '_stderrBuffer' : '_stdoutBuffer';
  const incoming = `${state[bufferKey] || ''}${String(chunk || '')}`;
  const lines = incoming.split(/\r?\n/);
  const trailing = lines.pop();
  state[bufferKey] = trailing;
  if (!lines.length) return '';
  return processVisibleLines(lines.join('\n'), state);
}

function flushProtocolBuffer(state, streamKey) {
  const bufferKey = streamKey === 'stderr' ? '_stderrBuffer' : '_stdoutBuffer';
  const trailing = String(state[bufferKey] || '');
  state[bufferKey] = '';
  if (!trailing) return '';
  return processVisibleLines(trailing, state);
}

function buildPythonEnv(extraEnv = {}) {
  return {
    ...process.env,
    CODEX_PYTHON_PROTOCOL: 'jsonl-v1',
    PYTHONIOENCODING: 'utf-8',
    ...extraEnv
  };
}

function buildPythonArgs(scriptPath, args = []) {
  return [scriptPath, ...args];
}

function createPythonError(scriptPath, protocol, fallbackMessage) {
  const err = new Error(protocol?.message || fallbackMessage || `${path.basename(scriptPath)} failed`);
  err.code = protocol?.code || 'PYTHON_SCRIPT_FAILED';
  err.stage = protocol?.stage || 'python';
  err.details = protocol?.details || fallbackMessage || '';
  err.hint = protocol?.hint || '';
  err.protocol = protocol || null;
  return err;
}

function runPythonScript(scriptPath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = createProtocolState();
    const proc = spawn('python', buildPythonArgs(scriptPath, args), {
      cwd: options.cwd,
      env: buildPythonEnv(options.env)
    });
    proc.codexPython = protocol;

    if (typeof options.onSpawn === 'function') {
      options.onSpawn(proc);
    }

    let stdout = '';
    let stderr = '';
    const heartbeatStartedAt = Date.now();
    let heartbeatHandle = null;

    if (typeof options.onHeartbeat === 'function') {
      heartbeatHandle = setInterval(() => {
        options.onHeartbeat(Math.max(0, Math.floor((Date.now() - heartbeatStartedAt) / 1000)), proc);
      }, Number(options.heartbeatMs) || 15000);
    }

    proc.stdout.on('data', (data) => {
      const visible = consumeProtocolChunk(protocol, 'stdout', data.toString());
      if (!visible) return;
      stdout += visible;
      if (typeof options.onStdout === 'function') options.onStdout(visible);
    });

    proc.stderr.on('data', (data) => {
      const visible = consumeProtocolChunk(protocol, 'stderr', data.toString());
      if (!visible) return;
      stderr += visible;
      if (typeof options.onStderr === 'function') options.onStderr(visible);
    });

    proc.on('error', (error) => {
      if (heartbeatHandle) clearInterval(heartbeatHandle);
      reject(createPythonError(scriptPath, protocol.error, error.message));
    });

    proc.on('close', (code) => {
      if (heartbeatHandle) clearInterval(heartbeatHandle);

      const remainingStdout = flushProtocolBuffer(protocol, 'stdout');
      if (remainingStdout) {
        stdout += remainingStdout;
        if (typeof options.onStdout === 'function') options.onStdout(remainingStdout);
      }
      const remainingStderr = flushProtocolBuffer(protocol, 'stderr');
      if (remainingStderr) {
        stderr += remainingStderr;
        if (typeof options.onStderr === 'function') options.onStderr(remainingStderr);
      }

      const payload = { stdout, stderr, code, protocol };
      if (code === 0) {
        resolve(payload);
        return;
      }

      const fallbackMessage = stderr.trim() || stdout.trim() || `${path.basename(scriptPath)} failed`;
      reject(createPythonError(scriptPath, protocol.error, fallbackMessage));
    });
  });
}

function runPythonScriptSync(scriptPath, args = [], options = {}) {
  const proc = spawnSync('python', buildPythonArgs(scriptPath, args), {
    cwd: options.cwd,
    env: buildPythonEnv(options.env),
    encoding: 'utf-8',
    timeout: options.timeout
  });

  const protocol = createProtocolState();
  const stdout = processVisibleLines(String(proc.stdout || ''), protocol);
  const stderr = processVisibleLines(String(proc.stderr || ''), protocol);
  const result = {
    ...proc,
    stdout,
    stderr,
    protocol
  };

  if (proc.error) {
    throw createPythonError(scriptPath, protocol.error, proc.error.message);
  }
  if (proc.status !== 0) {
    throw createPythonError(scriptPath, protocol.error, stderr.trim() || stdout.trim() || `${path.basename(scriptPath)} failed`);
  }
  return result;
}

module.exports = {
  PYTHON_PROTOCOL_PREFIX,
  runPythonScript,
  runPythonScriptSync
};
