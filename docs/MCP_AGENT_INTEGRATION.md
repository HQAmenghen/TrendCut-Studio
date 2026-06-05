# MCP Agent Integration

The MCP bridge lives in `mcp-server/` and calls the NestJS BFF by default:

```text
mcp-server -> http://127.0.0.1:3002/api/agent/v1/* -> BFF -> FastAPI
```

Access uses the same BFF auth model as browser API calls. Set `BFF_API_TOKEN` or `BFF_API_KEYS`; `AGENT_API_TOKEN` is accepted by the MCP bridge only as a fallback token source for local compatibility.

Core implementation files:

- `mcp-server/src/tools.js`
- `mcp-server/src/server.js`
- `apps/bff/src/agent-compat.controller.ts`
- `apps/api/src/trendcut_api/*`

High-risk actions such as publish confirmation are routed through BFF authorization and FastAPI publish audit records. MCP tools must not call Python scripts, RPA, or publish code directly.
