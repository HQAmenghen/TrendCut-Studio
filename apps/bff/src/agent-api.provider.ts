import { Injectable } from '@nestjs/common';
import { FastApiAgentClient } from '../../../packages/sdk/src/agent-client';

@Injectable()
export class AgentApiProvider {
  readonly client = new FastApiAgentClient(process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000');
}
