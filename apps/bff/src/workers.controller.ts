import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { WorkerApiProvider } from './worker-api.provider';

@Controller('/workers')
export class WorkersController {
  constructor(private readonly workerApi: WorkerApiProvider) {}

  @Get('types')
  listWorkerTypes() {
    return this.workerApi.client.listWorkerTypes();
  }

  @Post('jobs')
  createJob(@Body() body: Record<string, unknown>) {
    return this.workerApi.client.createJob(body as {
      task_id: string;
      job_type: string;
      payload?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      queue_name?: string;
      max_attempts?: number;
      timeout_seconds?: number;
    });
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.workerApi.client.getJob(id);
  }

  @Post('jobs/lease')
  @HttpCode(200)
  leaseJob(@Body() body: Record<string, unknown>) {
    return this.workerApi.client.leaseJob(body as { worker_id: string; queue_name?: string });
  }

  @Post('jobs/:id/heartbeat')
  @HttpCode(200)
  heartbeatJob(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.workerApi.client.heartbeatJob(id, body as { worker_id: string });
  }

  @Post('jobs/:id/complete')
  @HttpCode(200)
  completeJob(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.workerApi.client.completeJob(id, body as { worker_id: string; result?: Record<string, unknown>; artifacts?: unknown[] });
  }

  @Post('jobs/:id/fail')
  @HttpCode(200)
  failJob(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.workerApi.client.failJob(id, body as { worker_id: string; error?: Record<string, unknown>; retry?: boolean });
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancelJob(@Param('id') id: string) {
    return this.workerApi.client.cancelJob(id);
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  retryJob(@Param('id') id: string) {
    return this.workerApi.client.retryJob(id);
  }
}
