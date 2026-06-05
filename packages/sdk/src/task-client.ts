export interface TaskPayload {
  type: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  status?: string;
}

export interface TaskRecord {
  id: string;
  type: string;
  status: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export class FastApiTaskClient {
  constructor(private readonly baseUrl: string, private readonly internalToken = process.env.INTERNAL_API_TOKEN || 'dev-internal-token') {}

  async createTask(payload: TaskPayload): Promise<TaskRecord> {
    return this.request('/tasks', { method: 'POST', body: JSON.stringify(payload) });
  }

  async listTasks(params: { type?: string; status?: string; limit?: number } = {}): Promise<TaskRecord[]> {
    const query = new URLSearchParams();
    if (params.type) query.set('type', params.type);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', String(params.limit));
    return this.request(`/tasks${query.size ? `?${query.toString()}` : ''}`);
  }

  async getTask(id: string): Promise<TaskRecord> {
    return this.request(`/tasks/${encodeURIComponent(id)}`);
  }

  async cancelTask(id: string): Promise<TaskRecord> {
    return this.request(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }

  async resumeTask(id: string): Promise<TaskRecord> {
    return this.request(`/tasks/${encodeURIComponent(id)}/resume`, { method: 'POST' });
  }

  async listTaskSteps(id: string): Promise<unknown[]> {
    return this.request(`/tasks/${encodeURIComponent(id)}/steps`);
  }

  async listArtifacts(id: string): Promise<unknown[]> {
    return this.request(`/tasks/${encodeURIComponent(id)}/artifacts`);
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
      throw new Error(`FastAPI task request failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as T;
  }
}
