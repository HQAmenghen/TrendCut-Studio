const { resolveReviewTimeoutMs } = require('../executor');

describe('review executor timeout resolution', () => {
  test('uses a longer default process timeout for qwen reviews', () => {
    const timeoutMs = resolveReviewTimeoutMs({}, {
      LLM_PROVIDER: 'qwen',
      QWEN_MULTIMODAL_REQUEST_TIMEOUT_SECONDS: '420',
      QWEN_TEXT_REQUEST_TIMEOUT_SECONDS: '300'
    });

    expect(timeoutMs).toBe(45 * 60 * 1000);
  });

  test('expands qwen process timeout when request budgets exceed the default window', () => {
    const timeoutMs = resolveReviewTimeoutMs({}, {
      LLM_PROVIDER: 'qwen',
      QWEN_MULTIMODAL_REQUEST_TIMEOUT_SECONDS: '900',
      QWEN_TEXT_REQUEST_TIMEOUT_SECONDS: '600'
    });

    expect(timeoutMs).toBe(70 * 60 * 1000);
  });

  test('allows qwen timeout to be explicitly overridden', () => {
    const timeoutMs = resolveReviewTimeoutMs({}, {
      LLM_PROVIDER: 'qwen',
      AI_REVIEW_QWEN_TIMEOUT_SECONDS: '1200',
      QWEN_MULTIMODAL_REQUEST_TIMEOUT_SECONDS: '900',
      QWEN_TEXT_REQUEST_TIMEOUT_SECONDS: '600'
    });

    expect(timeoutMs).toBe(1200 * 1000);
  });

  test('keeps gemini reviews at least at the previous five minute timeout', () => {
    expect(resolveReviewTimeoutMs({ gemini_timeout: 180 }, {
      LLM_PROVIDER: 'gemini'
    })).toBe(5 * 60 * 1000);

    expect(resolveReviewTimeoutMs({ gemini_timeout: 600 }, {
      LLM_PROVIDER: 'gemini'
    })).toBe(10 * 60 * 1000);
  });
});
