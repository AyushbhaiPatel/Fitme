const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Never build a real client in tests
delete process.env.GEMINI_API_KEY;
mock.method(console, 'warn', () => {});
const gemini = require('./gemini');

const providerError = (status, message = `[${status}] provider error`, errorDetails) =>
  Object.assign(new Error(message), { status, statusText: 'x', errorDetails });

// Fake model whose generateContent runs the given steps in order (Error = throw, string = reply)
const stubModel = (steps) => {
  const generate = mock.fn(async () => {
    const step = steps[Math.min(generate.mock.callCount(), steps.length - 1)];
    if (step instanceof Error) throw step;
    return { response: Promise.resolve({ text: () => step }) };
  });
  mock.method(gemini, 'getModel', () => ({ generateContent: generate }));
  return generate;
};

// Records requested backoff delays and runs the callback immediately
const spySleep = () => {
  const delays = [];
  mock.method(globalThis, 'setTimeout', (fn, ms) => { delays.push(ms); fn(); return 0; });
  return delays;
};

describe('gemini.generateContent retry policy', () => {
  const saved = { ...gemini.retryConfig };

  beforeEach(() => {
    mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    Object.assign(gemini.retryConfig, saved);
    mock.restoreAll();
  });

  test('returns the text on the first try with no backoff', async () => {
    const generate = stubModel(['hello']);
    const delays = spySleep();
    assert.equal(await gemini.generateContent('p'), 'hello');
    assert.equal(generate.mock.callCount(), 1);
    assert.deepEqual(delays, []);
  });

  test('429 is retried with exponential backoff, exactly maxAttempts (3) tries, then rethrown', async () => {
    const err = providerError(429);
    const generate = stubModel([err]);
    const delays = spySleep();
    await assert.rejects(gemini.generateContent('p'), (e) => e === err);
    assert.equal(generate.mock.callCount(), 3);
    assert.deepEqual(delays, [500, 1000]); // baseDelayMs * 2^(n-1), no sleep after the last attempt
  });

  test('429 then success returns the reply after 2 attempts', async () => {
    const generate = stubModel([providerError(429), 'recovered']);
    const delays = spySleep();
    assert.equal(await gemini.generateContent('p'), 'recovered');
    assert.equal(generate.mock.callCount(), 2);
    assert.deepEqual(delays, [500]);
  });

  test('respects a changed retryConfig', async () => {
    gemini.retryConfig.maxAttempts = 2;
    gemini.retryConfig.baseDelayMs = 0;
    const generate = stubModel([providerError(429)]);
    const delays = spySleep();
    await assert.rejects(gemini.generateContent('p'));
    assert.equal(generate.mock.callCount(), 2);
    assert.deepEqual(delays, [0]);
  });

  for (const [label, err] of [
    ['400 API_KEY_INVALID', providerError(400, 'API key not valid. Please pass a valid API key.', [{ reason: 'API_KEY_INVALID' }])],
    ['401', providerError(401)],
    ['403', providerError(403)],
    ['500', providerError(500)],
    ['503', providerError(503)],
    ['no status (network)', new Error('fetch failed')],
  ]) {
    test(`${label} is not retried`, async () => {
      const generate = stubModel([err]);
      const delays = spySleep();
      await assert.rejects(gemini.generateContent('p'), (e) => e === err);
      assert.equal(generate.mock.callCount(), 1);
      assert.deepEqual(delays, []);
    });
  }

  test('throws "Gemini not initialized" without calling a model when none is configured', async () => {
    mock.method(gemini, 'getModel', () => null);
    await assert.rejects(gemini.generateContent('p'), /Gemini not initialized/);
  });
});

describe('error classifiers', () => {
  test('isRateLimitError only matches status 429', () => {
    assert.equal(gemini.isRateLimitError(providerError(429)), true);
    for (const s of [400, 401, 403, 500, 503, undefined]) assert.equal(gemini.isRateLimitError(providerError(s)), false);
    assert.equal(gemini.isRateLimitError(null), false);
  });

  test('isAuthError matches 401/403 and 400 with API_KEY_INVALID only', () => {
    assert.equal(gemini.isAuthError(providerError(401)), true);
    assert.equal(gemini.isAuthError(providerError(403)), true);
    assert.equal(gemini.isAuthError(providerError(400, 'bad', [{ reason: 'API_KEY_INVALID' }])), true);
    assert.equal(gemini.isAuthError(providerError(400, 'API key not valid. Please pass a valid API key.')), true);
    assert.equal(gemini.isAuthError(providerError(400, 'Invalid JSON payload')), false);
    assert.equal(gemini.isAuthError(providerError(429)), false);
    assert.equal(gemini.isAuthError(providerError(500)), false);
    assert.equal(gemini.isAuthError(undefined), false);
  });
});
