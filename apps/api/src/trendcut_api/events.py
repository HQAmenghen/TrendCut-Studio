import json
from redis import Redis
from .schemas import TaskEvent, TaskRead
from .settings import get_settings

TASK_EVENTS_CHANNEL = 'trendcut.task-events'


def publish_task_event(task) -> None:
    event = TaskEvent(task_id=task.id, status=task.status, task=TaskRead.model_validate(task))
    payload = event.model_dump_json(by_alias=False)
    settings = get_settings()
    try:
        redis = Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        redis.publish(TASK_EVENTS_CHANNEL, payload)
    except Exception:
        # Redis events are best-effort in Phase 2. The database remains authoritative.
        return


def encode_sse_event(payload: dict) -> str:
    return f"event: task.updated\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
