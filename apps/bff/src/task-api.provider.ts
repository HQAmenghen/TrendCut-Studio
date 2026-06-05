import { Injectable } from '@nestjs/common';
import { FastApiTaskClient } from '../../../packages/sdk/src/task-client';

@Injectable()
export class TaskApiProvider {
  readonly client = new FastApiTaskClient(process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000');
}
