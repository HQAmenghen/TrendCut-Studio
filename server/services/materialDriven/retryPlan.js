function normalizeStep(step) {
  const parsed = Number(step);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1;
}

function resolveRetryPipelinePlan(step) {
  const startFrom = normalizeStep(step);
  const stopAfterNarration = startFrom === 5;
  return {
    startFrom,
    endAt: stopAfterNarration ? 5 : null,
    stopAfterNarration
  };
}

function buildMaterialDrivenPipelineArgs({
  scriptPath,
  materialPath,
  outputPath,
  startFrom,
  endAt = null,
  useSmartClip = true,
  useCache = true,
  unbuffered = false
}) {
  const args = [];
  if (unbuffered) {
    args.push('-u');
  }
  args.push(
    scriptPath,
    materialPath,
    '--output-dir',
    outputPath,
    '--start-from',
    String(normalizeStep(startFrom))
  );
  if (endAt !== null && endAt !== undefined) {
    args.push('--end-at', String(normalizeStep(endAt)));
  }
  if (!useSmartClip) {
    args.push('--no-smart-clip');
  }
  if (useCache) {
    args.push('--use-cache');
  }
  return args;
}

module.exports = {
  buildMaterialDrivenPipelineArgs,
  resolveRetryPipelinePlan
};
