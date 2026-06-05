# SDK

Client packages used by the NestJS BFF to call FastAPI.

Rules:

- Generate clients from `packages/contracts` OpenAPI documents.
- Keep browser clients out of this package.
- Surface typed errors and trace ids so BFF logs can correlate with FastAPI and worker records.
