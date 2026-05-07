# Quick Task 260506-ehk: 在 .env 添加 RUNNINGHUB_API_KEY 字段

## Goal

Add the RunningHub API key environment variable placeholder to the local `.env` file without exposing or changing existing secret values.

## Tasks

1. Check whether `.env` already contains `RUNNINGHUB_API_KEY`.
2. Add `RUNNINGHUB_API_KEY=` only if it is missing.
3. Verify the key exists without printing the `.env` contents.
