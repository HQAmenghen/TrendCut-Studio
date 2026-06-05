# Project Structure

```text
trendcut-studio/
├─ apps/
│  ├─ bff/        # NestJS browser and MCP/API compatibility entry
│  ├─ api/        # FastAPI task, AI, agent, publish, and worker control plane
│  └─ worker/     # Python worker runtime
├─ packages/
│  ├─ contracts/  # Shared schemas and protocol contracts
│  └─ sdk/        # TypeScript clients used by the BFF
├─ frontend/      # Vue 3 workbench
├─ python/        # AI, media, review, publish, and RPA Python capabilities
├─ mcp-server/    # MCP tool bridge, calling the BFF on port 3002 by default
├─ config/        # Workflow and runtime configuration
├─ docs/          # Current architecture and operations docs
├─ scripts/       # CI, boundary checks, and maintenance scripts
└─ vendor/        # Vendored platform automation dependencies
```

The former Express runtime tree has been removed from this branch. The supported runtime path is:

```text
Vue frontend -> NestJS BFF -> FastAPI -> PostgreSQL / Redis -> Python workers -> Python tools / Playwright / FFmpeg / LLMs
```
