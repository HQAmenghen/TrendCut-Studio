---
status: complete
date: 2026-05-07
branch: codex/directory-boundary-cleanup
---

# Directory Boundary Cleanup Summary

## Completed

- Removed tracked runtime artifacts from the git index while preserving local files where they still exist.
- Cleared tracked `projects/` and `data/` contents from version control.
- Cleared generated public videos from version control while keeping `public/presets/` tracked.
- Cleared Python pipeline/publish/xAI runtime outputs from version control.
- Cleared root-level temporary benchmark/test artifacts from version control.
- Cleared local IDE and machine settings from version control.
- Added ignore rules for `.idea/` and `.claude/settings.local.json`.

## Verification

- `git ls-files data projects` returns zero tracked files.
- Runtime artifact pattern scan returns zero tracked matches.
- Local `data/`, `projects/`, `.idea/`, and `.claude/settings.local.json` still exist on disk.
