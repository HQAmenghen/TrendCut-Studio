import { Controller, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TaskEventsService } from './task-events.service';

@Controller('/tasks')
export class TaskEventsController {
  constructor(private readonly taskEvents: TaskEventsService) {}

  @Sse('/events')
  events(): Observable<MessageEvent> {
    return this.taskEvents.stream();
  }
}
