# TrendCut Studio Release Prep Summary

## Outcome

Prepared the project for the first complete executable release under the name **TrendCut Studio（热点剪辑工作室）**.

## Changes

- Renamed project-facing product surfaces from Comfy Panel Demo to TrendCut Studio.
- Updated package metadata, Docker Compose service name, frontend document title, app header, startup script, Agent service identity, and MCP package naming.
- Added `TRENDCUT_STUDIO_AGENT_BASE_URL` while keeping `COMFY_PANEL_AGENT_BASE_URL` as a backward-compatible MCP fallback.
- Refreshed README, docs, AGENTS, and planning/codebase notes around the current automated hotspot video clipping workflow.
- Removed unmounted legacy Vue workspace components and their obsolete source-inspection test.
- Kept runtime contract names such as `aiman.mp4`, `aiman_subtitles.json`, API routes, database fields, and historical debug records unchanged.

## Validation

- `npm test` passed: 48 suites, 310 tests.
- `npm run lint` passed.
- `npm run build:front` passed.
