import { Injectable } from '@nestjs/common';
import { FastApiAiClient } from '../../../packages/sdk/src/ai-client';

@Injectable()
export class AiApiProvider {
  readonly client = new FastApiAiClient(process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000');
}
