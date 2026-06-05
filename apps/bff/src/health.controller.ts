import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { FastApiClient } from './fastapi.client';

@Controller()
export class HealthController {
  constructor(private readonly fastApiClient: FastApiClient) {}

  @Get('/health')
  getHealth() {
    return {
      status: 'ok',
      service: 'trendcut-bff',
      timestamp: new Date().toISOString()
    };
  }

  @Get('/internal/health')
  async getInternalHealth() {
    try {
      const api = await this.fastApiClient.getInternalHealth();
      return {
        status: 'ok',
        service: 'trendcut-bff',
        dependencies: { api },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new HttpException({
        status: 'degraded',
        service: 'trendcut-bff',
        dependencies: {
          api: {
            status: 'unavailable',
            error: error instanceof Error ? error.message : String(error)
          }
        },
        timestamp: new Date().toISOString()
      }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
