import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { AiApiProvider } from './ai-api.provider';
import { requireRole } from './bff-authz';
import { validateAiGenerate } from './validation';

@Controller('/ai')
export class AiController {
  constructor(private readonly aiApi: AiApiProvider) {}

  @Get('/prompts')
  listPrompts(@Req() request: any) {
    requireRole(request.user, 'ai:read', 'ai:write');
    return this.aiApi.client.listPrompts();
  }

  @Post('/generate')
  @HttpCode(200)
  generate(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'ai:write');
    return this.aiApi.client.generate(validateAiGenerate(body));
  }
}
