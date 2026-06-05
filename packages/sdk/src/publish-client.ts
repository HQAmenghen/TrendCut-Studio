export class FastApiPublishClient {
  constructor(private readonly baseUrl: string) {}

  async createJob(payload: Record<string, unknown>): Promise<unknown> {
    return this.request('/publish/jobs', { method: 'POST', body: JSON.stringify(payload) });
  }

  async listJobs(params: { platform?: string; status?: string; limit?: number } = {}): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params.platform) query.set('platform', params.platform);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', String(params.limit));
    return this.request(`/publish/jobs${query.size ? `?${query.toString()}` : ''}`);
  }

  async getJob(id: string): Promise<unknown> {
    return this.request(`/publish/jobs/${encodeURIComponent(id)}`);
  }

  async confirmJob(id: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/publish/jobs/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async dispatchJob(id: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/publish/jobs/${encodeURIComponent(id)}/dispatch`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async cancelJob(id: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/publish/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async listAudit(id: string): Promise<unknown[]> {
    return this.request(`/publish/jobs/${encodeURIComponent(id)}/audit`);
  }

  async listAccounts(platform?: string): Promise<unknown[]> {
    const query = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    return this.request(`/publish/accounts${query}`);
  }

  async checkLogin(platform: string, accountId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/publish/accounts/${encodeURIComponent(platform)}/${encodeURIComponent(accountId)}/login-check`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(init.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`FastAPI publish request failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as T;
  }
}
