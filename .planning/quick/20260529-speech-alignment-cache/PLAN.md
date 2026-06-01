# Quick Task: Speech Alignment Cache

## Goal
Generate a reusable ASR alignment artifact for final Qwen3TTS narration audio, use it to improve avatar motion trigger timing, and expose the same subtitle timing to vertical composition import.

## Scope
- Add cached `speech_alignment.json`, `speech_subtitles.json`, and `speech_alignment_meta.json` artifacts in material task directories.
- Generate the artifacts after Qwen3TTS audio synthesis when avatar generation runs.
- Teach avatar motion planning to prefer ASR-aligned trigger timestamps when available.
- Teach vertical task import/reference subtitle selection to prefer the cached speech subtitles.
- Add focused tests for cache reuse, motion timing, and vertical subtitle source priority.
