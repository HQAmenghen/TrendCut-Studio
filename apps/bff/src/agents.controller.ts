import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AgentApiProvider } from './agent-api.provider';

@Controller('/agents')
export class AgentsController {
  constructor(private readonly agentApi: AgentApiProvider) {}

  @Get('/tools')
  listTools() {
    return this.agentApi.client.listTools();
  }

  @Post('/runs')
  createRun(@Body() body: Record<string, unknown>) {
    return this.agentApi.client.createRun(body);
  }

  @Get('/runs/:id')
  getRun(@Param('id') id: string) {
    return this.agentApi.client.getRun(id);
  }

  @Post('/runs/:id/resume')
  @HttpCode(200)
  resumeRun(@Param('id') id: string) {
    return this.agentApi.client.resumeRun(id);
  }

  @Post('/runs/:id/tool-calls')
  @HttpCode(200)
  createToolCall(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.agentApi.client.createToolCall(id, body);
  }
}
