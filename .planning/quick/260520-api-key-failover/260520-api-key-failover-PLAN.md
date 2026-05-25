# Quick Task 260520: API Key Failover

## Goal

Add backup API key failover for Qwen/DashScope and DeepSeek calls so a single exhausted or unavailable key does not fail recent generation tasks immediately.

## Tasks

1. Harden Python LLM clients.
   - Add key-level failover markers for quota, balance, authentication, and rate-limit style failures.
   - Ensure retries rotate keys across Qwen and DeepSeek attempts.

2. Cover direct Qwen call sites.
   - Update ASR/TTS/direct DashScope paths that currently pin the first key.
   - Preserve existing model and timeout behavior.

3. Expose and document multi-key config.
   - Add DeepSeek to system LLM config.
   - Clarify semicolon/comma separated keys in examples.
   - Add focused tests for failover behavior.
