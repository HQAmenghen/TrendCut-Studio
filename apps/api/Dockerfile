FROM python:3.11-slim

WORKDIR /app

COPY apps/api/requirements*.txt ./apps/api/
RUN pip install --no-cache-dir -r apps/api/requirements.lock.txt

COPY apps/api ./apps/api

EXPOSE 8000

CMD ["sh", "-c", "python apps/api/scripts/migrate.py && uvicorn trendcut_api.main:app --app-dir apps/api/src --host 0.0.0.0 --port 8000"]
