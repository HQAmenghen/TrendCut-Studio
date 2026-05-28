const {
  buildMaterialDrivenPipelineArgs,
  resolveRetryPipelinePlan
} = require('../retryPlan');

describe('material-driven retry pipeline plan', () => {
  test('retrying step 5 stops at narration so Node can handle avatar generation', () => {
    const plan = resolveRetryPipelinePlan(5);

    expect(plan.startFrom).toBe(5);
    expect(plan.endAt).toBe(5);
    expect(plan.stopAfterNarration).toBe(true);

    const args = buildMaterialDrivenPipelineArgs({
      scriptPath: 'run_material_driven.py',
      materialPath: 'material.mp4',
      outputPath: 'project',
      startFrom: plan.startFrom,
      endAt: plan.endAt,
      useSmartClip: true,
      useCache: true,
      unbuffered: true
    });

    expect(args).toEqual([
      '-u',
      'run_material_driven.py',
      'material.mp4',
      '--output-dir',
      'project',
      '--start-from',
      '5',
      '--end-at',
      '5',
      '--use-cache'
    ]);
  });

  test('retrying step 6 keeps running through final render', () => {
    const plan = resolveRetryPipelinePlan(6);

    expect(plan.startFrom).toBe(6);
    expect(plan.endAt).toBe(null);
    expect(plan.stopAfterNarration).toBe(false);
  });

  test('can opt into rule fallback for unattended or manual material runs', () => {
    const args = buildMaterialDrivenPipelineArgs({
      scriptPath: 'run_material_driven.py',
      materialPath: 'material.mp4',
      outputPath: 'project',
      startFrom: 1,
      endAt: 5,
      useSmartClip: true,
      useCache: true,
      allowRuleFallback: true,
      unbuffered: true
    });

    expect(args).toContain('--allow-rule-fallback');
  });
});
