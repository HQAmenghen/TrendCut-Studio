---
status: complete
completed_at: "2026-06-01T10:10:00+08:00"
task: "重写开源项目标准 README 文档并推送"
---

# Summary

Rewrote the root README as a public-facing open-source project overview.

## Completed

- Added repository and stack badges.
- Reorganized the README into standard sections: overview, features, workflow, stack, requirements, quick start, Docker, commands, structure, runtime boundaries, docs, development notes, testing, contribution, and license status.
- Removed informal and AI-pattern wording from the prior introduction.
- Preserved the current Node.js + Vue + Python architecture and material-driven production workflow.

## Verification

- Checked the README diff.
- Searched for common AI-style phrases called out by the user.
- Ran `git diff --check` after cleanup.
