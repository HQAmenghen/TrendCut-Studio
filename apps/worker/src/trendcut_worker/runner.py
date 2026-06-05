from __future__ import annotations

import argparse
import os
import socket
import time
from pathlib import Path
from typing import Any

from .client import FastApiWorkerControlClient
from .executor import execute_job


def main() -> int:
    parser = argparse.ArgumentParser(description='TrendCut worker runner')
    parser.add_argument('--api-base-url', default=os.getenv('FASTAPI_BASE_URL', 'http://127.0.0.1:8000'))
    parser.add_argument('--queue', default=os.getenv('WORKER_QUEUE', 'video'))
    parser.add_argument('--worker-id', default=os.getenv('WORKER_ID') or f'{socket.gethostname()}:{os.getpid()}')
    parser.add_argument('--artifact-root', default=os.getenv('WORKER_ARTIFACT_ROOT', 'data/worker-artifacts'))
    parser.add_argument('--poll-interval', type=float, default=float(os.getenv('WORKER_POLL_INTERVAL', '2')))
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()

    client = FastApiWorkerControlClient(args.api_base_url)
    artifact_root = Path(args.artifact_root).resolve()

    while True:
        did_work = run_once(client, args.worker_id, args.queue, artifact_root)
        if args.once:
            return 0
        if not did_work:
            time.sleep(args.poll_interval)


def run_once(client: FastApiWorkerControlClient, worker_id: str, queue_name: str, artifact_root: Path) -> bool:
    job = client.lease_job(worker_id, queue_name)
    if not job:
        return False

    try:
        client.heartbeat_job(job['id'], worker_id)
        output = execute_job(job, artifact_root)
        client.complete_job(job['id'], worker_id, output['result'], output['artifacts'])
    except Exception as exc:
        error = _serialize_exception(exc)
        try:
            client.fail_job(job['id'], worker_id, error, retry=True)
        except Exception:
            raise exc
    return True


def _serialize_exception(exc: Exception) -> dict[str, Any]:
    return {
        'type': exc.__class__.__name__,
        'message': str(exc)
    }


if __name__ == '__main__':
    raise SystemExit(main())
