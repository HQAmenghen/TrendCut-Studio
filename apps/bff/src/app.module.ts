import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { FastApiClient } from './fastapi.client';
import { TasksController } from './tasks.controller';
import { TaskApiProvider } from './task-api.provider';
import { TaskEventsController } from './task-events.controller';
import { TaskEventsService } from './task-events.service';

@Module({
  controllers: [HealthController, TasksController, TaskEventsController],
  providers: [FastApiClient, TaskApiProvider, TaskEventsService]
})
export class AppModule {}
