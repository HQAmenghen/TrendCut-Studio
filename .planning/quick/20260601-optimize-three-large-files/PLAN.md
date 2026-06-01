---
title: Optimize Three Large Files
status: completed
created_at: "2026-06-01T15:30:00+08:00"
---

# Optimize Three Large Files

## Objective

Reduce structural coupling in the three current hotspot files without broad behavioral rewrites:

- `python/pipeline/run_asr.py`
- `python/pipeline/run_material_driven.py`
- `frontend/src/components/AutomationDashboard.vue`

## Scope

- Extract coherent helper modules/components only where there is a stable boundary.
- Preserve existing public CLI/API/operator behavior.
- Avoid visual redesign and avoid removing current capabilities.
- Keep changes reviewable and covered by existing tests where possible.

## Initial Targets

- Move ASR provider/config/filetrans helpers out of `run_asr.py` if dependency direction is clean.
- Move material-driven CLI or step payload helpers out of `run_material_driven.py` if isolated.
- Move one self-contained modal/control area out of `AutomationDashboard.vue` if props/events stay manageable.

## Verification

- `npm run lint`
- `npm run build:front`
- `npm test -- --runInBand`
- Focused Python tests if import boundaries are touched.
