import { Injectable } from '@nestjs/common';
import { FastApiWorkerClient } from '../../../packages/sdk/src/worker-client';

@Injectable()
export class WorkerApiProvider {
  readonly client = new FastApiWorkerClient(process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000');
}
