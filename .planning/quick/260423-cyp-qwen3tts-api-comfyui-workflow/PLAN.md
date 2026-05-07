---
status: in_progress
created: 2026-04-23
---

# Quick Task: Qwen3TTS API ComfyUI Workflow

## Goal

Replace ComfyUI-embedded CosyVoice TTS in the material-driven avatar path with local Qwen3TTS API voice cloning plus speech synthesis. ComfyUI should receive one final speech audio input and the avatar image.

## Scope

- Keep the existing Node + Vue + Python split.
- Add a Python Qwen3TTS script that creates a cloned voice, synthesizes narration, downloads the returned audio URL, and reports protocol output.
- Add a Node service wrapper that runs the Python script and validates the generated audio artifact.
- Update material-driven avatar generation to synthesize audio locally before submitting the ComfyUI workflow.
- Rewire `config/workflow_api.json` so node `6` is the only speech audio input consumed by downstream avatar/video nodes.
- Add focused Jest coverage and run verification.

## Out of Scope

- Frontend UI changes for choosing TTS models.
- Voice cache management UI.
- Replacing ComfyUI avatar/video rendering.
