export interface WorkerJobPayload {
  task_id: string;
  job_type: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  queue_name?: string;
  max_attempts?: number;
  timeout_seconds?: number;
}

export interface WorkerJobRecord {
  id: string;
  task_id: string;
  task_step_id?: string | null;
  job_type: string;
  queue_name: string;
  status: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  timeout_seconds: number;
  locked_by?: string | null;
  heartbeat_at?: string | null;
  run_after?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export class FastApiWorkerClient {
  constructor(private readonly baseUrl: string, private readonly internalToken = process.env.INTERNAL_API_TOKEN || 'dev-internal-token') {}

  async listWorkerTypes(): Promise<unknown[]> {
    return this.request('/workers/types');
  }

  async createJob(payload: WorkerJobPayload): Promise<WorkerJobRecord> {
    return this.request('/workers/jobs', { method: 'POST', body: JSON.stringify(payload) });
  }

  async getJob(id: string): Promise<WorkerJobRecord> {
    return this.request(`/workers/jobs/${encodeURIComponent(id)}`);
  }

  async leaseJob(payload: { worker_id: string; queue_name?: string }): Promise<WorkerJobRecord | null> {
    return this.request('/workers/jobs/lease', { method: 'POST', body: JSON.stringify(payload) });
  }

  async heartbeatJob(id: string, payload: { worker_id: string }): Promise<WorkerJobRecord> {
    return this.request(`/workers/jobs/${encodeURIComponent(id)}/heartbeat`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async completeJob(id: string, payload: { worker_id: string; result?: Record<string, unknown>; artifacts?: unknown[] }): Promise<WorkerJobRecord> {
    return this.request(`/workers/jobs/${encodeURIComponent(id)}/complete`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async failJob(id: string, payload: { worker_id: string; error?: Record<string, unknown>; retry?: boolean }): Promise<WorkerJobRecord> {
    return this.request(`/workers/jobs/${encodeURIComponent(id)}/fail`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async cancelJob(id: string): Promise<WorkerJobRecord> {
    return this.request(`/workers/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }

  async retryJob(id: string): Promise<WorkerJobRecord> {
    return this.request(`/workers/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-trendcut-internal-token': this.internalToken,
        ...(init.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`FastAPI worker request failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as T;
  }
}
