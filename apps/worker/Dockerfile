FROM python:3.12-slim

WORKDIR /app

COPY apps/worker/requirements.lock.txt /app/apps/worker/requirements.lock.txt
RUN pip install --no-cache-dir -r /app/apps/worker/requirements.lock.txt

COPY apps/worker /app/apps/worker
COPY python /app/python

ENV PYTHONPATH=/app/apps/worker/src:/app/python
ENV FASTAPI_BASE_URL=http://api:8000
ENV WORKER_QUEUE=video
ENV WORKER_ARTIFACT_ROOT=/app/data/worker-artifacts

CMD ["python", "-m", "trendcut_worker.runner"]
