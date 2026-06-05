export interface AiGeneratePayload {
  capability: string;
  input?: Record<string, unknown>;
  task_id?: string;
  preferred_models?: string[];
}

export class FastApiAiClient {
  constructor(private readonly baseUrl: string) {}

  async listPrompts(): Promise<Record<string, unknown>> {
    return this.request('/ai/prompts');
  }

  async generate(payload: AiGeneratePayload): Promise<Record<string, unknown>> {
    return this.request('/ai/generate', { method: 'POST', body: JSON.stringify(payload) });
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
      throw new Error(`FastAPI AI request failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as T;
  }
}
