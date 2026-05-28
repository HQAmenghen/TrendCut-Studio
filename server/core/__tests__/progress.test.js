const { attachProgressRoute, sendEvent } = require('../progress');

describe('progress route', () => {
  test('registers client and sends an initial connected event', () => {
    const handlers = {};
    const app = {
      get: jest.fn((path, handler) => {
        handlers[path] = handler;
      })
    };
    const req = {
      query: { clientId: 'client-1' },
      on: jest.fn()
    };
    const res = {
      writeHead: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn()
    };

    attachProgressRoute(app);
    handlers['/api/progress'](req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream'
    }));
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"msg":"进度通道已连接"'));
    expect(sendEvent('client-1', { type: 'status', msg: '下一帧' })).toBe(true);
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"msg":"下一帧"'));

    const closeHandler = req.on.mock.calls.find(([eventName]) => eventName === 'close')?.[1];
    closeHandler();
    expect(sendEvent('client-1', { type: 'status', msg: '关闭后' })).toBe(false);
  });
});
