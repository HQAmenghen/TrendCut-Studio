import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable } from 'rxjs';
import { createClient, RedisClientType } from 'redis';

const TASK_EVENTS_CHANNEL = 'trendcut.task-events';

@Injectable()
export class TaskEventsService implements OnModuleDestroy {
  private subscriber: RedisClientType | null = null;

  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      let closed = false;
      const connect = async () => {
        try {
          const client = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379/0' });
          this.subscriber = client as RedisClientType;
          client.on('error', (error) => {
            if (!closed) observer.next({ data: JSON.stringify({ type: 'task.events.error', error: error.message }) } as MessageEvent);
          });
          await client.connect();
          await client.subscribe(TASK_EVENTS_CHANNEL, (message) => {
            if (!closed) observer.next({ data: message } as MessageEvent);
          });
        } catch (error) {
          if (!closed) {
            observer.next({
              data: JSON.stringify({
                type: 'task.events.unavailable',
                error: error instanceof Error ? error.message : String(error)
              })
            } as MessageEvent);
          }
        }
      };
      connect();
      return () => {
        closed = true;
        this.closeSubscriber();
      };
    });
  }

  async onModuleDestroy() {
    await this.closeSubscriber();
  }

  private async closeSubscriber() {
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber?.isOpen) {
      await subscriber.quit().catch(() => undefined);
    }
  }
}
