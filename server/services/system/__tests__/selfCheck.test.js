const { createSelfCheckService } = require('../selfCheck');

describe('self check service', () => {
  test('includes capability checks in the generated report', () => {
    const service = createSelfCheckService({
      fs: { existsSync: jest.fn(() => true) },
      spawnSync: jest.fn(() => ({ status: 0, stdout: 'ok' })),
      capabilityChecks: [
        {
          key: 'external_service',
          label: 'External Service',
          level: 'warn',
          run: () => ({ ok: false, details: 'offline', hint: 'start service' })
        }
      ]
    });

    const report = service.run();
    const group = report.groups.find((item) => item.key === 'capabilities');

    expect(group).toBeTruthy();
    expect(group.items[0]).toEqual(expect.objectContaining({
      key: 'external_service',
      status: 'warn',
      details: 'offline',
      hint: 'start service'
    }));
    expect(report.summary.warnCount).toBe(1);
  });
});
