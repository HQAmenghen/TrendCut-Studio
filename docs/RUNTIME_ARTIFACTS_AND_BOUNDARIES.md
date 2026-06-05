# Runtime Artifacts And Boundaries

Supported runtime boundaries:

- `frontend/`: Vue source.
- `frontend-dist/`: generated frontend build output.
- `apps/bff/`: public HTTP entry.
- `apps/api/`: internal FastAPI control plane.
- `apps/worker/`: Python worker runtime.
- `python/`: executable AI/media/RPA capabilities.
- `mcp-server/`: MCP bridge that calls the BFF.

Do not commit generated project outputs, transient worker files, local cookies, Playwright profiles, or downloaded media unless they are explicit tests or fixtures.
