import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { AgentApiProvider } from './agent-api.provider';
import { requireRole } from './bff-authz';
import { validateAgentRunCreate, validateToolCallCreate } from './validation';

@Controller('/agents')
export class AgentsController {
  constructor(private readonly agentApi: AgentApiProvider) {}

  @Get('/tools')
  listTools(@Req() request: any) {
    requireRole(request.user, 'agent:read', 'agent:write');
    return this.agentApi.client.listTools();
  }

  @Post('/runs')
  createRun(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.agentApi.client.createRun(validateAgentRunCreate(body));
  }

  @Get('/runs/:id')
  getRun(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'agent:read', 'agent:write');
    return this.agentApi.client.getRun(id);
  }

  @Post('/runs/:id/resume')
  @HttpCode(200)
  resumeRun(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.agentApi.client.resumeRun(id);
  }

  @Post('/runs/:id/tool-calls')
  @HttpCode(200)
  createToolCall(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.agentApi.client.createToolCall(id, validateToolCallCreate(body));
  }
}
