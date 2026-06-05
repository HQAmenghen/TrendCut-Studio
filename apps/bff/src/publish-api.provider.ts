import { Injectable } from '@nestjs/common';
import { FastApiPublishClient } from '../../../packages/sdk/src/publish-client';

@Injectable()
export class PublishApiProvider {
  readonly client = new FastApiPublishClient(process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000');
}
