function checkPythonImports(modules, { spawnSync }) {
  const script = [
    'import importlib, sys',
    `modules = ${JSON.stringify(modules)}`,
    'missing = []',
    'for item in modules:',
    '    try:',
    '        importlib.import_module(item)',
    '    except Exception as exc:',
    '        missing.append(f"{item}: {exc.__class__.__name__}")',
    'if missing:',
    '    print("\\n".join(missing))',
    '    sys.exit(1)',
    'print("imports-ok")'
  ].join('\n');
  const proc = spawnSync('python', ['-c', script], {
    encoding: 'utf-8',
    timeout: 15000
  });
  return {
    ok: proc.status === 0,
    details: proc.status === 0
      ? 'required Python packages import successfully'
      : String(proc.stderr || proc.stdout || proc.error?.message || 'missing Python packages').trim()
  };
}

function checkPlaywrightBrowser({ spawnSync }) {
  const script = [
    'from pathlib import Path',
    'from playwright.sync_api import sync_playwright',
    'with sync_playwright() as p:',
    '    browser = p.chromium.launch(headless=True)',
    '    browser.close()',
    'print("playwright-browser-ok")'
  ].join('\n');
  const proc = spawnSync('python', ['-c', script], {
    encoding: 'utf-8',
    timeout: 20000
  });
  return {
    ok: proc.status === 0,
    details: proc.status === 0
      ? 'Playwright Chromium can launch'
      : String(proc.stderr || proc.stdout || proc.error?.message || 'Playwright browser launch failed').trim()
  };
}

function checkComfyConfig({ env }) {
  const rawUrl = String(env.COMFYUI_BASE_URL || '').trim();
  if (!rawUrl) {
    return {
      ok: false,
      details: 'COMFYUI_BASE_URL missing',
      hint: '未配置时数字人 ComfyUI 渲染链路不可用'
    };
  }
  try {
    const url = new URL(rawUrl);
    return {
      ok: ['http:', 'https:'].includes(url.protocol),
      details: ['http:', 'https:'].includes(url.protocol)
        ? `configured: ${url.origin}`
        : `unsupported protocol: ${url.protocol}`
    };
  } catch (_err) {
    return {
      ok: false,
      details: `invalid URL: ${rawUrl}`,
      hint: '请配置类似 http://127.0.0.1:8188 的 ComfyUI 地址'
    };
  }
}

function createRuntimeCapabilityChecks() {
  return [
    {
      key: 'python_media_packages',
      label: 'Python 媒体/AI 依赖',
      run: (deps) => checkPythonImports([
        'requests',
        'httpx',
        'PIL',
        'moviepy',
        'cv2',
        'dashscope',
        'google.genai',
        'openai'
      ], deps),
      hint: '请运行 python -m pip install -r requirements.lock.txt'
    },
    {
      key: 'python_opencc',
      label: 'OpenCC 简繁转换依赖',
      level: 'warn',
      run: (deps) => checkPythonImports(['opencc'], deps),
      hint: '缺失时繁体字幕归一化会降级；请运行 python -m pip install opencc-python-reimplemented==0.1.7'
    },
    {
      key: 'playwright_browser',
      label: 'Playwright 浏览器',
      level: 'warn',
      run: checkPlaywrightBrowser,
      hint: '缺失时微信/平台 RPA 不可用；请运行 python -m playwright install chromium'
    },
    {
      key: 'comfyui_config',
      label: 'ComfyUI 配置',
      level: 'warn',
      run: checkComfyConfig,
      hint: '未配置或格式错误时数字人 ComfyUI 渲染不可用'
    }
  ];
}

module.exports = {
  checkComfyConfig,
  checkPlaywrightBrowser,
  checkPythonImports,
  createRuntimeCapabilityChecks
};
