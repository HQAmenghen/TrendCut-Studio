import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { WorkerApiProvider } from './worker-api.provider';
import { requireRole } from './bff-authz';
import {
  validateWorkerComplete,
  validateWorkerFail,
  validateWorkerHeartbeat,
  validateWorkerJobCreate,
  validateWorkerLease
} from './validation';

@Controller('/workers')
export class WorkersController {
  constructor(private readonly workerApi: WorkerApiProvider) {}

  @Get('types')
  listWorkerTypes(@Req() request: any) {
    requireRole(request.user, 'worker:read', 'worker:write', 'worker:runtime');
    return this.workerApi.client.listWorkerTypes();
  }

  @Post('jobs')
  createJob(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return this.workerApi.client.createJob(validateWorkerJobCreate(body));
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'worker:read', 'worker:write', 'worker:runtime');
    return this.workerApi.client.getJob(id);
  }

  @Post('jobs/lease')
  @HttpCode(200)
  leaseJob(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:runtime');
    return this.workerApi.client.leaseJob(validateWorkerLease(body));
  }

  @Post('jobs/:id/heartbeat')
  @HttpCode(200)
  heartbeatJob(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:runtime');
    return this.workerApi.client.heartbeatJob(id, validateWorkerHeartbeat(body));
  }

  @Post('jobs/:id/complete')
  @HttpCode(200)
  completeJob(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:runtime');
    return this.workerApi.client.completeJob(id, validateWorkerComplete(body));
  }

  @Post('jobs/:id/fail')
  @HttpCode(200)
  failJob(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:runtime');
    return this.workerApi.client.failJob(id, validateWorkerFail(body));
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancelJob(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return this.workerApi.client.cancelJob(id);
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  retryJob(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return this.workerApi.client.retryJob(id);
  }
}
