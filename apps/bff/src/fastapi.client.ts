import { Injectable } from '@nestjs/common';

export interface FastApiHealth {
  status: string;
  service: string;
  dependencies?: Record<string, unknown>;
  [key: string]: unknown;
}

@Injectable()
export class FastApiClient {
  private readonly baseUrl = (process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

  async getInternalHealth(): Promise<FastApiHealth> {
    const response = await fetch(`${this.baseUrl}/internal/health`, {
      method: 'GET',
      headers: { accept: 'application/json' }
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`FastAPI health check failed with ${response.status}: ${JSON.stringify(body)}`);
    }

    return body as FastApiHealth;
  }
}
