import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { TaskApiProvider } from './task-api.provider';
import { parseLimit, validateTaskCreate } from './validation';

@Controller('/tasks')
export class TasksController {
  constructor(private readonly taskApi: TaskApiProvider) {}

  @Post()
  createTask(@Body() body: Record<string, unknown>) {
    return this.taskApi.client.createTask(validateTaskCreate(body));
  }

  @Get()
  listTasks(@Query('type') type?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.taskApi.client.listTasks({
      type,
      status,
      limit: parseLimit(limit)
    });
  }

  @Get(':id')
  getTask(@Param('id') id: string) {
    return this.taskApi.client.getTask(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancelTask(@Param('id') id: string) {
    return this.taskApi.client.cancelTask(id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resumeTask(@Param('id') id: string) {
    return this.taskApi.client.resumeTask(id);
  }

  @Get(':id/steps')
  listTaskSteps(@Param('id') id: string) {
    return this.taskApi.client.listTaskSteps(id);
  }

  @Get(':id/artifacts')
  listArtifacts(@Param('id') id: string) {
    return this.taskApi.client.listArtifacts(id);
  }
}
