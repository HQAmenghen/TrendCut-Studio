from datetime import datetime, timezone
from fastapi import FastAPI
from redis import Redis
from .database import check_database
from .settings import get_settings

app = FastAPI(
    title='TrendCut AI Backend',
    version='0.1.0',
    description='FastAPI control plane for tasks, AI orchestration, and workers.'
)


@app.get('/health')
def health():
    return {
        'status': 'ok',
        'service': 'trendcut-api',
        'timestamp': datetime.now(timezone.utc).isoformat()
    }


@app.get('/internal/health')
def internal_health():
    settings = get_settings()
    dependencies = {}
    status = 'ok'

    try:
        check_database()
        dependencies['postgres'] = {'status': 'ok'}
    except Exception as exc:
        dependencies['postgres'] = {'status': 'unavailable', 'error': str(exc)}
        status = 'degraded'

    try:
        redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        redis.ping()
        dependencies['redis'] = {'status': 'ok'}
    except Exception as exc:
        dependencies['redis'] = {'status': 'unavailable', 'error': str(exc)}
        status = 'degraded'

    return {
        'status': status,
        'service': 'trendcut-api',
        'environment': settings.api_env,
        'dependencies': dependencies,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
