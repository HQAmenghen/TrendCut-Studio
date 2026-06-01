const fs = require('fs');
const path = require('path');

const PYTHON_PROTOCOL_VERSION = 'jsonl-v1';
const PYTHON_PROTOCOL_PREFIX = '__CODEX_PYTHON__';
const PYTHON_PROTOCOL_SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'contracts', 'python_protocol.schema.json');

let cachedSchema = null;

function loadPythonProtocolSchema() {
  if (!cachedSchema) {
    cachedSchema = JSON.parse(fs.readFileSync(PYTHON_PROTOCOL_SCHEMA_PATH, 'utf8'));
  }
  return cachedSchema;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createProtocolValidationError(reason, details = {}) {
  const err = new Error(`Invalid Python protocol event: ${reason}`);
  err.code = 'PYTHON_PROTOCOL_SCHEMA_INVALID';
  err.reason = reason;
  err.details = details;
  return err;
}

function assertStringField(event, field, { required = true, minLength = 0 } = {}) {
  if (!(field in event)) {
    if (required) throw createProtocolValidationError(`missing ${field}`, { event });
    return;
  }
  if (typeof event[field] !== 'string') {
    throw createProtocolValidationError(`${field} must be a string`, { event });
  }
  if (event[field].length < minLength) {
    throw createProtocolValidationError(`${field} is too short`, { event });
  }
}

function validatePythonProtocolEvent(event) {
  if (!isPlainObject(event)) {
    throw createProtocolValidationError('event must be an object', { event });
  }

  const type = String(event.type || '').trim();
  if (!['stage', 'result', 'error'].includes(type)) {
    throw createProtocolValidationError('unsupported event type', { event });
  }

  if (type === 'stage') {
    assertStringField(event, 'stage', { minLength: 1 });
    assertStringField(event, 'message');
  } else if (type === 'result') {
    assertStringField(event, 'message');
  } else if (type === 'error') {
    assertStringField(event, 'code', { minLength: 1 });
    if (!/^[A-Z][A-Z0-9_]*$/.test(event.code)) {
      throw createProtocolValidationError('error code must be UPPER_SNAKE_CASE', { event });
    }
    assertStringField(event, 'message', { minLength: 1 });
    assertStringField(event, 'stage', { minLength: 1 });
    assertStringField(event, 'details');
    assertStringField(event, 'hint');
  }

  return true;
}

module.exports = {
  PYTHON_PROTOCOL_PREFIX,
  PYTHON_PROTOCOL_SCHEMA_PATH,
  PYTHON_PROTOCOL_VERSION,
  createProtocolValidationError,
  loadPythonProtocolSchema,
  validatePythonProtocolEvent
};
