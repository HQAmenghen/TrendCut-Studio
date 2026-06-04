---
status: complete
---

Implemented manual X URL import.

Changes:
- Added `/api/xai-top10/import-url`.
- Added `--import-url` mode to `python/xai/run_xai_top10.py`.
- Added source intake URL input and xAI composable import state.
- Added visible manual import running/success/error feedback in the source intake panel.
- Changed manual URL import to use direct X API/page lookup first and avoid xAI search/credit usage.
- Added xAI service unit coverage for manual import.

Verification:
- `python -m py_compile python/xai/run_xai_top10.py`
- `npm run lint`
- `npm run build:front`
- `npx jest server/services/xai/__tests__/service.test.js --runInBand`
- `node --check server.js`
- `POST /api/xai-top10/import-url` empty body returns structured `XAI_IMPORT_URL_MISSING`.
- `XAI_API_KEY` cleared, `python/xai/run_xai_top10.py --import-url https://x.com/Vivek4real_/status/2061603451470246295 ...` succeeds with `xai_request_count: 0`.
