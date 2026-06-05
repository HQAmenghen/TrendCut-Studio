import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { FastApiClient } from './fastapi.client';

@Module({
  controllers: [HealthController],
  providers: [FastApiClient]
})
export class AppModule {}
