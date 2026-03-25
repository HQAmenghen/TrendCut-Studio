const checks = [
  { name: 'system self-check', method: 'GET', path: '/api/system/self-check' },
  { name: 'presets', method: 'GET', path: '/api/presets' },
  { name: 'workflow config', method: 'GET', path: '/api/workflow-config' },
  { name: 'publish assets', method: 'GET', path: '/api/publish/assets' },
  { name: 'publish jobs', method: 'GET', path: '/api/publish/jobs' },
  { name: 'xai status', method: 'GET', path: '/api/xai-top10/status' },
  { name: 'vertical queue', method: 'GET', path: '/api/xai-top10/vertical-jobs' }
];

async function main() {
  const baseUrl = process.argv[2] || 'http://127.0.0.1:3001';
  let failed = false;

  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    try {
      const response = await fetch(url, { method: check.method });
      const text = await response.text();
      const preview = text.slice(0, 180).replace(/\s+/g, ' ').trim();
      if (!response.ok) {
        failed = true;
        console.error(`[FAIL] ${check.name} ${response.status} ${url}`);
        console.error(`       ${preview}`);
        continue;
      }
      console.log(`[OK]   ${check.name} ${response.status} ${url}`);
    } catch (err) {
      failed = true;
      console.error(`[FAIL] ${check.name} request error ${url}`);
      console.error(`       ${err.message}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log('Smoke test passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
