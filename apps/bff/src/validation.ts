import { BadRequestException } from '@nestjs/common';

const TASK_STATUSES = new Set(['created', 'queued', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled', 'retrying']);
const PUBLISH_MODES = new Set(['draft', 'publish', 'login_check']);
const AI_CAPABILITIES = new Set(['title_generation', 'publish_copy', 'script_polish', 'material_score', 'video_review']);
const AGENT_GRAPHS = new Set(['script_agent', 'material_agent', 'review_agent']);
const WORKER_TYPES = new Set(['asr_worker', 'material_score_worker', 'script_worker', 'material_driven_worker', 'clip_plan_worker', 'render_worker', 'review_worker', 'xai_worker', 'publish_worker', 'rpa_worker']);
const HIGH_RISK_WORKERS = new Set(['publish_worker', 'rpa_worker']);
const HIGH_RISK_TOOLS = new Set(['publish.execute', 'file.delete']);

export function asRecord(value: unknown, field = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `${field} must be an object` });
  }
  return value as Record<string, unknown>;
}

export function optionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return asRecord(value, field);
}

export function requiredString(value: unknown, field: string, max = 160): string {
  const text = String(value || '').trim();
  if (!text) throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `${field} is required` });
  if (text.length > max) throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `${field} is too long` });
  return text;
}

export function optionalString(value: unknown, field: string, max = 160): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, field, max);
}

export function parseLimit(value: string | undefined, fallback = 50): number {
  if (!value) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: 'limit must be an integer from 1 to 200' });
  }
  return limit;
}

export function optionalBoolean(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `${field} must be a boolean` });
}

export function optionalPositiveInt(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `${field} must be an integer from ${min} to ${max}` });
  }
  return parsed;
}

export function optionalStringArray(value: unknown, field: string, maxItems = 5): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `${field} must be an array` });
  }
  if (value.length > maxItems) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `${field} is too large` });
  }
  return value.map((item, index) => requiredString(item, `${field}[${index}]`, 120));
}

export function validateTaskCreate(value: unknown) {
  const body = asRecord(value);
  const status = optionalString(body.status, 'status', 40);
  if (status && !TASK_STATUSES.has(status)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `unsupported task status: ${status}` });
  }
  return {
    type: requiredString(body.type, 'type', 120),
    input: optionalRecord(body.input, 'input') || {},
    metadata: optionalRecord(body.metadata, 'metadata') || {},
    ...(status ? { status } : {})
  };
}

export function validateAiGenerate(value: unknown) {
  const body = asRecord(value);
  const capability = requiredString(body.capability, 'capability', 120);
  if (!AI_CAPABILITIES.has(capability)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `unsupported AI capability: ${capability}` });
  }
  return {
    capability,
    input: optionalRecord(body.input, 'input') || {},
    task_id: optionalString(body.task_id, 'task_id', 64),
    preferred_models: optionalStringArray(body.preferred_models, 'preferred_models')
  };
}

export function validateAgentRunCreate(value: unknown) {
  const body = asRecord(value);
  const graphName = requiredString(body.graph_name, 'graph_name', 120);
  if (!AGENT_GRAPHS.has(graphName)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `unsupported agent graph: ${graphName}` });
  }
  return {
    task_id: requiredString(body.task_id, 'task_id', 64),
    graph_name: graphName,
    state: optionalRecord(body.state, 'state') || {}
  };
}

export function validateToolCallCreate(value: unknown) {
  const body = asRecord(value);
  const toolName = requiredString(body.tool_name, 'tool_name', 120);
  const confirmed = optionalBoolean(body.confirmed, 'confirmed', false);
  if (HIGH_RISK_TOOLS.has(toolName) && confirmed !== true) {
    throw new BadRequestException({ code: 'BFF_HIGH_RISK_CONFIRMATION_REQUIRED', message: `${toolName} requires confirmed=true` });
  }
  return {
    tool_name: toolName,
    input: optionalRecord(body.input, 'input') || {},
    confirmed
  };
}

export function validateWorkerJobCreate(value: unknown) {
  const body = asRecord(value);
  const jobType = requiredString(body.job_type, 'job_type', 120);
  if (!WORKER_TYPES.has(jobType)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `unsupported worker job type: ${jobType}` });
  }
  const payload = optionalRecord(body.payload, 'payload') || {};
  if (HIGH_RISK_WORKERS.has(jobType) && payload.confirmed !== true) {
    throw new BadRequestException({ code: 'BFF_HIGH_RISK_CONFIRMATION_REQUIRED', message: `${jobType} requires payload.confirmed=true` });
  }
  return {
    task_id: requiredString(body.task_id, 'task_id', 64),
    job_type: jobType,
    payload,
    metadata: optionalRecord(body.metadata, 'metadata') || {},
    queue_name: optionalString(body.queue_name, 'queue_name', 80),
    max_attempts: optionalPositiveInt(body.max_attempts, 'max_attempts', 3, 1, 10),
    timeout_seconds: optionalPositiveInt(body.timeout_seconds, 'timeout_seconds', 900, 1, 86400)
  };
}

export function validateWorkerLease(value: unknown) {
  const body = asRecord(value);
  return {
    worker_id: requiredString(body.worker_id, 'worker_id', 160),
    queue_name: optionalString(body.queue_name, 'queue_name', 80)
  };
}

export function validateWorkerHeartbeat(value: unknown) {
  const body = asRecord(value);
  return {
    worker_id: requiredString(body.worker_id, 'worker_id', 160)
  };
}

export function validateWorkerComplete(value: unknown) {
  const body = asRecord(value);
  const artifacts = body.artifacts === undefined || body.artifacts === null ? [] : body.artifacts;
  if (!Array.isArray(artifacts)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: 'artifacts must be an array' });
  }
  return {
    worker_id: requiredString(body.worker_id, 'worker_id', 160),
    result: optionalRecord(body.result, 'result') || {},
    artifacts
  };
}

export function validateWorkerFail(value: unknown) {
  const body = asRecord(value);
  return {
    worker_id: requiredString(body.worker_id, 'worker_id', 160),
    error: optionalRecord(body.error, 'error') || {},
    retry: optionalBoolean(body.retry, 'retry', true)
  };
}

export function validatePublishJobCreate(value: unknown) {
  const body = asRecord(value);
  const mode = optionalString(body.mode, 'mode', 40) || 'draft';
  if (!PUBLISH_MODES.has(mode)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `unsupported publish mode: ${mode}` });
  }
  return {
    platform: requiredString(body.platform, 'platform', 80),
    account_id: requiredString(body.account_id, 'account_id', 160),
    account_label: optionalString(body.account_label, 'account_label', 240),
    mode,
    asset: optionalRecord(body.asset, 'asset') || {},
    publish_data: optionalRecord(body.publish_data, 'publish_data') || {},
    metadata: optionalRecord(body.metadata, 'metadata') || {}
  };
}

export function actorCommand(value: unknown, actor: string) {
  const body = value ? asRecord(value) : {};
  return {
    actor,
    reason: optionalString(body.reason, 'reason', 500)
  };
}

export function dispatchCommand(value: unknown, actor: string) {
  const body = value ? asRecord(value) : {};
  const mode = optionalString(body.mode, 'mode', 40);
  if (mode && !PUBLISH_MODES.has(mode)) {
    throw new BadRequestException({ code: 'BFF_INVALID_DTO', message: `unsupported publish mode: ${mode}` });
  }
  return {
    actor,
    ...(mode ? { mode } : {}),
    ...(body.job_type ? { job_type: optionalString(body.job_type, 'job_type', 120) } : {})
  };
}

export function loginCheckCommand(value: unknown, actor: string) {
  const body = value ? asRecord(value) : {};
  return {
    actor,
    account_label: optionalString(body.account_label, 'account_label', 240)
  };
}
