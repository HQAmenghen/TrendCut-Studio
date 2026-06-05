import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { PublishApiProvider } from './publish-api.provider';
import { actorCommand, dispatchCommand, loginCheckCommand, parseLimit, validatePublishJobCreate } from './validation';

@Controller('/publish')
export class PublishController {
  constructor(private readonly publishApi: PublishApiProvider) {}

  @Post('jobs')
  createJob(@Body() body: Record<string, unknown>) {
    return this.publishApi.client.createJob(validatePublishJobCreate(body));
  }

  @Get('jobs')
  listJobs(@Query('platform') platform?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.publishApi.client.listJobs({
      platform,
      status,
      limit: parseLimit(limit)
    });
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.publishApi.client.getJob(id);
  }

  @Post('jobs/:id/confirm')
  @HttpCode(200)
  confirmJob(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    return this.publishApi.client.confirmJob(id, actorCommand(body, request.user.actor));
  }

  @Post('jobs/:id/dispatch')
  @HttpCode(200)
  dispatchJob(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    return this.publishApi.client.dispatchJob(id, dispatchCommand(body, request.user.actor));
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancelJob(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    return this.publishApi.client.cancelJob(id, actorCommand(body, request.user.actor));
  }

  @Get('jobs/:id/audit')
  listAudit(@Param('id') id: string) {
    return this.publishApi.client.listAudit(id);
  }

  @Get('accounts')
  listAccounts(@Query('platform') platform?: string) {
    return this.publishApi.client.listAccounts(platform);
  }

  @Post('accounts/:platform/:accountId/login-check')
  @HttpCode(200)
  checkLogin(@Param('platform') platform: string, @Param('accountId') accountId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    return this.publishApi.client.checkLogin(platform, accountId, loginCheckCommand(body, request.user.actor));
  }
}
