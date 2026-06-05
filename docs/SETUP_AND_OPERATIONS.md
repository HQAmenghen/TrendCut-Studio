# Setup And Operations

## Local

```powershell
npm install
pip install -r requirements.lock.txt
python -m playwright install chromium
npm run build:front
npm run start:api
npm start
```

The BFF listens on `http://localhost:3002` by default. FastAPI listens on `http://127.0.0.1:8000` for local development, but browser clients must still call the BFF.

## Docker Compose

```powershell
docker compose up --build
```

Compose exposes the BFF and keeps FastAPI on the internal service network.

## Auth

Set one of:

- `BFF_API_TOKEN`
- `BFF_API_KEYS`
- `BFF_AUTH_DISABLED=true` for local-only development

MCP should use the same BFF token.

## Verification

```powershell
npm run check:legacy-boundary
npm run check:bff
npm run check:api
npm test
npm run test:py
npm run build:front
npm run lint
```
