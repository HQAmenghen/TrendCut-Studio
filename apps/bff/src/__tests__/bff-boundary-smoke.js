const assert = require('assert');
const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '..', '..', 'tsconfig.json')
});
const { BadRequestException, ForbiddenException, ServiceUnavailableException } = require('@nestjs/common');
const { BffRequestGuard } = require('../bff-request.guard');
const { requireRole } = require('../bff-authz');
const {
  validateAiGenerate,
  validateToolCallCreate,
  validateWorkerJobCreate
} = require('../validation');

function makeContext(headers = {}, path = '/tasks') {
  const request = { path, headers, ip: '127.0.0.1' };
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  return {
    request,
    response,
    context: {
      switchToHttp() {
        return {
          getRequest: () => request,
          getResponse: () => response
        };
      }
    }
  };
}

function assertThrows(fn, ErrorType) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof ErrorType, `expected ${ErrorType.name}, got ${thrown && thrown.constructor && thrown.constructor.name}`);
}

const originalEnv = { ...process.env };

process.env.BFF_API_KEYS = JSON.stringify({
  'user-token': { actor: 'real-user', roles: ['ai:write'], tenant_id: 'tenant-a' }
});
delete process.env.BFF_AUTH_DISABLED;
delete process.env.BFF_API_TOKEN;

const guard = new BffRequestGuard();
const { context, request, response } = makeContext({
  authorization: 'Bearer user-token',
  'x-user-id': 'forged-user'
});
assert.strictEqual(guard.canActivate(context), true);
assert.deepStrictEqual(request.user, {
  actor: 'real-user',
  roles: ['ai:write'],
  tenantId: 'tenant-a',
  authMode: 'token'
});
assert.strictEqual(response.headers['x-trendcut-bff'], 'true');

process.env = { ...originalEnv };
delete process.env.BFF_API_KEYS;
delete process.env.BFF_API_TOKEN;
delete process.env.BFF_AUTH_DISABLED;
assertThrows(() => new BffRequestGuard().canActivate(makeContext({ authorization: 'Bearer unconfigured' }).context), ServiceUnavailableException);

assertThrows(() => validateAiGenerate({ capability: 'raw_provider_passthrough' }), BadRequestException);
assert.deepStrictEqual(validateAiGenerate({ capability: 'title_generation', input: { title: 'demo' } }), {
  capability: 'title_generation',
  input: { title: 'demo' },
  task_id: undefined,
  preferred_models: undefined
});

assertThrows(() => validateToolCallCreate({ tool_name: 'publish.execute', input: {} }), BadRequestException);
assert.deepStrictEqual(validateToolCallCreate({ tool_name: 'publish.execute', input: {}, confirmed: true }), {
  tool_name: 'publish.execute',
  input: {},
  confirmed: true
});

assertThrows(() => validateWorkerJobCreate({
  task_id: 'task-1',
  job_type: 'publish_worker',
  payload: {}
}), BadRequestException);
assert.strictEqual(validateWorkerJobCreate({
  task_id: 'task-1',
  job_type: 'script_worker',
  payload: {}
}).job_type, 'script_worker');

assertThrows(() => requireRole({ actor: 'viewer', roles: ['ai:read'], authMode: 'token' }, 'worker:write'), ForbiddenException);
assert.doesNotThrow(() => requireRole({ actor: 'admin', roles: ['admin'], authMode: 'token' }, 'worker:write'));
