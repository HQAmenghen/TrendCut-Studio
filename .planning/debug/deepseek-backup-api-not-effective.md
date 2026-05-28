---
status: investigating
trigger: "DeepSeek request exits with code 1. Logs show 402 Insufficient Balance and 'retrying with next configured key', but the fallback API does not appear to take effect."
created: 2026-05-20
updated: 2026-05-20
---

# Debug Session: deepseek-backup-api-not-effective

## Symptoms

- Expected behavior: when one DeepSeek API key has insufficient balance, the client should retry with the next configured key.
- Actual behavior: process exits with code 1 and logs repeat the same masked key suffix.
- Error messages: `Error code: 402 - {'error': {'message': 'Insufficient Balance', ...}}`
- Timeline: reported from current local run.
- Reproduction: run a DeepSeek-backed workflow with primary key out of balance.

## Current Focus

- hypothesis: DeepSeek key failover is either configured with only one parsed key, or the second configured key has the same visible suffix / is also unavailable.
- test: inspect DeepSeek key parsing and retry loop, then verify current environment shape without exposing secrets.
- expecting: code should reveal delimiter rules and whether attempts equal the number of parsed keys.
- next_action: inspect `python/deepseek_client.py`, `.env` key format, and relevant tests.

## Evidence

## Eliminated

## Resolution

- root_cause:
- fix:
- verification:
- files_changed:
