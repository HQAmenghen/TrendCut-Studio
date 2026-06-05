from __future__ import annotations

from typing import Any
import httpx


class FastApiWorkerControlClient:
    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout

    def lease_job(self, worker_id: str, queue_name: str) -> dict[str, Any] | None:
        response = httpx.post(
            f'{self.base_url}/workers/jobs/lease',
            json={'worker_id': worker_id, 'queue_name': queue_name},
            timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()

    def heartbeat_job(self, job_id: str, worker_id: str) -> dict[str, Any]:
        response = httpx.post(
            f'{self.base_url}/workers/jobs/{job_id}/heartbeat',
            json={'worker_id': worker_id},
            timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()

    def complete_job(self, job_id: str, worker_id: str, result: dict[str, Any], artifacts: list[dict[str, Any]]) -> dict[str, Any]:
        response = httpx.post(
            f'{self.base_url}/workers/jobs/{job_id}/complete',
            json={'worker_id': worker_id, 'result': result, 'artifacts': artifacts},
            timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()

    def fail_job(self, job_id: str, worker_id: str, error: dict[str, Any], retry: bool = True) -> dict[str, Any]:
        response = httpx.post(
            f'{self.base_url}/workers/jobs/{job_id}/fail',
            json={'worker_id': worker_id, 'error': error, 'retry': retry},
            timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()
