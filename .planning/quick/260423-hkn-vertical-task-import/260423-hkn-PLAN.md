# Vertical Task Import Implementation Plan

Goal: Add a manual task picker to the vertical composition module so operators can render a selected material-driven task using its existing video and JSON metadata.

Architecture: Add a focused server helper for scanning material-driven project directories and resolving one task into standalone vertical input files. Reuse the existing standalone vertical render path, adding `sourceTaskDir` as an alternate input to uploaded video. Add frontend state and controls in the standalone module for listing, selecting, and submitting a task-backed render.

Tech Stack: Express, Node filesystem helpers, Vue 3 Composition API, Jest.

## Tasks

1. Add tests for material-driven task discovery and payload resolution.
2. Implement a `server/services/vertical/taskImport.js` helper with safe directory validation, JSON fallback order, and execution-plan subtitle recovery.
3. Wire `GET /api/vertical/material-tasks` and extend `/api/generate-vertical-standalone` to accept `sourceTaskDir`.
4. Update `useStandalone.js`, `StandaloneWorkspace.vue`, and `App.vue` to expose refresh/select/import controls and preserve manual upload behavior.
5. Run focused Jest tests, lint server files, and build the frontend.
