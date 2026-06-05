# SDK

Client packages used by the NestJS BFF to call FastAPI.

Rules:

- Generate clients from `packages/contracts` OpenAPI documents.
- Keep browser clients out of this package.
- Surface typed errors and trace ids so BFF logs can correlate with FastAPI and worker records.

Phase 2:

- `src/task-client.ts` contains the BFF-side FastAPI task client.
- `src/ai-client.ts` contains the BFF-side FastAPI AI client.
- `src/agent-client.ts` contains the BFF-side FastAPI Agent client.
- `src/worker-client.ts` contains the BFF-side FastAPI Worker client.
