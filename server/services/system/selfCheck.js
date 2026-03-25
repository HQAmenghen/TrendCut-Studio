function createSelfCheckService(deps) {
  const {
    fs,
    spawnSync,
    envRequirements = [],
    directoryChecks = [],
    fileChecks = [],
    commandChecks = []
  } = deps;

  function normalizeStatus(ok, level = 'fail') {
    if (ok) return 'ok';
    return level === 'warn' ? 'warn' : 'fail';
  }

  function runCommandCheck(check) {
    const proc = spawnSync(check.command, check.args || [], {
      encoding: 'utf-8',
      timeout: Number.isFinite(Number(check.timeoutMs)) ? Number(check.timeoutMs) : 10000
    });
    const ok = proc.status === 0;
    return {
      key: check.key,
      label: check.label,
      status: normalizeStatus(ok, check.level),
      required: check.level !== 'warn',
      details: ok
        ? String(proc.stdout || proc.stderr || '').trim()
        : String(proc.stderr || proc.stdout || proc.error?.message || 'command failed').trim(),
      hint: ok ? '' : String(check.hint || '')
    };
  }

  function runEnvCheck(check) {
    const value = String(process.env[check.key] || '').trim();
    const ok = !!value;
    return {
      key: check.key,
      label: check.label || check.key,
      status: normalizeStatus(ok, check.level),
      required: check.level !== 'warn',
      details: ok ? 'configured' : 'missing',
      hint: ok ? '' : String(check.hint || '')
    };
  }

  function runPathCheck(check, kind) {
    const exists = fs.existsSync(check.path);
    return {
      key: check.key,
      label: check.label,
      status: normalizeStatus(exists, check.level),
      required: check.level !== 'warn',
      details: exists ? `${kind} exists` : `${kind} missing`,
      path: check.path,
      hint: exists ? '' : String(check.hint || '')
    };
  }

  function summarize(groups) {
    const all = groups.flatMap((group) => group.items);
    const failCount = all.filter((item) => item.status === 'fail').length;
    const warnCount = all.filter((item) => item.status === 'warn').length;
    return {
      status: failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'ok',
      failCount,
      warnCount,
      okCount: all.filter((item) => item.status === 'ok').length
    };
  }

  function run() {
    const groups = [
      {
        key: 'env',
        label: '环境变量',
        items: envRequirements.map(runEnvCheck)
      },
      {
        key: 'commands',
        label: '运行依赖',
        items: commandChecks.map(runCommandCheck)
      },
      {
        key: 'directories',
        label: '关键目录',
        items: directoryChecks.map((check) => runPathCheck(check, 'directory'))
      },
      {
        key: 'files',
        label: '关键脚本',
        items: fileChecks.map((check) => runPathCheck(check, 'file'))
      }
    ];

    return {
      generatedAt: new Date().toISOString(),
      summary: summarize(groups),
      groups
    };
  }

  return {
    run
  };
}

module.exports = {
  createSelfCheckService
};
