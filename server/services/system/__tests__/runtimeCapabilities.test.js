const {
  checkComfyConfig,
  checkPythonImports
} = require('../runtimeCapabilities');

describe('runtime capability checks', () => {
  test('validates ComfyUI URL configuration without contacting the service', () => {
    expect(checkComfyConfig({ env: { COMFYUI_BASE_URL: 'http://127.0.0.1:8188' } })).toEqual(
      expect.objectContaining({
        ok: true,
        details: 'configured: http://127.0.0.1:8188'
      })
    );

    expect(checkComfyConfig({ env: { COMFYUI_BASE_URL: 'not a url' } })).toEqual(
      expect.objectContaining({
        ok: false
      })
    );
  });

  test('reports missing Python imports as unavailable capabilities', () => {
    const spawnSync = jest.fn(() => ({
      status: 1,
      stdout: 'missing_package: ModuleNotFoundError',
      stderr: ''
    }));

    const result = checkPythonImports(['missing_package'], { spawnSync });

    expect(result.ok).toBe(false);
    expect(result.details).toContain('missing_package');
    expect(spawnSync).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining(['-c', expect.stringContaining('missing_package')]),
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });
});
