import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AiApiProvider } from './ai-api.provider';

@Controller('/ai')
export class AiController {
  constructor(private readonly aiApi: AiApiProvider) {}

  @Get('/prompts')
  listPrompts() {
    return this.aiApi.client.listPrompts();
  }

  @Post('/generate')
  @HttpCode(200)
  generate(@Body() body: Record<string, unknown>) {
    return this.aiApi.client.generate(body as { capability: string; input?: Record<string, unknown>; task_id?: string; preferred_models?: string[] });
  }
}
