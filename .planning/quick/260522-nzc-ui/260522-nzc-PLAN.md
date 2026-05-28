# Quick Task 260522-nzc: Auto-Pilot Avatar Preset Selection

## Goal
Add per-plan avatar preset selection to Auto-Pilot's avatar publishing flow, defaulting the avatar image to `毕（保守）.png` and voice to `毕.mp3`, while reducing the density of the scheduling UI.

## Tasks
1. Extend publish-center state so avatar-mode schedules can save and display per-plan `audioPreset` and `imagePreset` values.
2. Pass the selected per-plan avatar presets through the system scheduler into material-driven avatar generation.
3. Rework the Auto-Pilot plan rows into a compact main row plus collapsible advanced settings for cleaner UI.

## Verification
- Run focused frontend/server checks where available.
- Build or lint enough to catch template/script syntax errors.
