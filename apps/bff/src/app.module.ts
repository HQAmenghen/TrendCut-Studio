import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { FastApiClient } from './fastapi.client';
import { TasksController } from './tasks.controller';
import { TaskApiProvider } from './task-api.provider';
import { TaskEventsController } from './task-events.controller';
import { TaskEventsService } from './task-events.service';
import { AiController } from './ai.controller';
import { AiApiProvider } from './ai-api.provider';
import { AgentsController } from './agents.controller';
import { AgentApiProvider } from './agent-api.provider';
import { WorkersController } from './workers.controller';
import { WorkerApiProvider } from './worker-api.provider';

@Module({
  controllers: [HealthController, TasksController, TaskEventsController, AiController, AgentsController, WorkersController],
  providers: [FastApiClient, TaskApiProvider, TaskEventsService, AiApiProvider, AgentApiProvider, WorkerApiProvider]
})
export class AppModule {}
