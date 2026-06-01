---
status: complete
created: "2026-06-01T10:00:00+08:00"
---

# TrendCut Studio Release Prep

## Goal

Prepare the repository for the first complete executable release under the product name **TrendCut Studio（热点剪辑工作室）**.

## Scope

- Rename project-facing surfaces from Comfy Panel Demo to TrendCut Studio.
- Rename safe code identifiers, package metadata, Docker service names, and local browser storage keys where compatibility can be preserved.
- Refresh README and long-lived docs so the product positioning matches the hotspot-to-video-editing automation workflow.
- Keep runtime protocol names such as `aiman.mp4` and external dependency names such as ComfyUI unchanged.
- Remove only clearly unused legacy frontend components that are not imported by the executable app.
- Run validation before commit.

## Validation

- `npm test` - passed, 48 suites / 310 tests
- `npm run lint` - passed
- `npm run build:front` - passed
