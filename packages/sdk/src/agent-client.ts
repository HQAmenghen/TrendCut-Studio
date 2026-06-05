export class FastApiAgentClient {
  constructor(private readonly baseUrl: string, private readonly internalToken = process.env.INTERNAL_API_TOKEN || 'dev-internal-token') {}

  listTools(): Promise<Record<string, unknown>> {
    return this.request('/agents/tools');
  }

  createRun(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('/agents/runs', { method: 'POST', body: JSON.stringify(payload) });
  }

  getRun(id: string): Promise<Record<string, unknown>> {
    return this.request(`/agents/runs/${encodeURIComponent(id)}`);
  }

  resumeRun(id: string): Promise<Record<string, unknown>> {
    return this.request(`/agents/runs/${encodeURIComponent(id)}/resume`, { method: 'POST' });
  }

  createToolCall(runId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/agents/runs/${encodeURIComponent(runId)}/tool-calls`, { method: 'POST', body: JSON.stringify(payload) });
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
      throw new Error(`FastAPI Agent request failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as T;
  }
}
