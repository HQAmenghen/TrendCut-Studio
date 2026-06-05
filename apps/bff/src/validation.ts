import { BadRequestException } from '@nestjs/common';

const TASK_STATUSES = new Set(['created', 'queued', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled', 'retrying']);
const PUBLISH_MODES = new Set(['draft', 'publish', 'login_check']);

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
