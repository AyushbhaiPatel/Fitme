const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Never build a real Gemini client in tests
delete process.env.GEMINI_API_KEY;
mock.method(console, 'warn', () => {});

const gemini = require('../../config/gemini');
const aicoachDao = require('./aicoach.dao');
const service = require('./aicoach.service');

const user = { _id: 'u1', firstName: 'Sam', fitnessGoals: ['muscle-gain'], fitnessExperience: 'beginner' };

const providerError = (status, message = `[${status}] provider error`, errorDetails) =>
  Object.assign(new Error(message), { status, errorDetails });

// Fake Gemini model: steps run in order (Error = throw, string = reply); the last step repeats
const stubModel = (steps) => {
  const generate = mock.fn(async () => {
    const step = steps[Math.min(generate.mock.callCount(), steps.length - 1)];
    if (step instanceof Error) throw step;
    return { response: Promise.resolve({ text: () => step }) };
  });
  mock.method(gemini, 'getModel', () => ({ generateContent: generate }));
  return generate;
};

describe('aicoach.service.chat', () => {
  const savedRetry = { ...gemini.retryConfig };
  let createInteraction;

  beforeEach(() => {
    gemini.retryConfig.baseDelayMs = 0;
    mock.method(console, 'error', () => {});
    mock.method(gemini, 'isAvailable', () => true);
    createInteraction = mock.method(aicoachDao, 'createInteraction', async (payload) => ({ ...payload, created_at: '2026-01-01T00:00:00.000Z' }));
  });

  afterEach(() => {
    Object.assign(gemini.retryConfig, savedRetry);
    mock.restoreAll();
  });

  test('returns a normal reply for a valid message', async () => {
    const generate = stubModel(['**Great** question! Do 3 sets of squats.']);
    const history = [{ role: 'user', content: 'earlier question' }, { role: 'assistant', content: 'earlier answer' }];

    const result = await service.chat('How do I build legs?', history, user);

    assert.equal(result.code, 200);
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { response: 'Great question! Do 3 sets of squats.', recipes: null, timestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(generate.mock.callCount(), 1);
    const prompt = generate.mock.calls[0].arguments[0];
    assert.match(prompt, /Name: Sam/);
    assert.match(prompt, /User: earlier question\nAssistant: earlier answer\nUser: How do I build legs\?\nAssistant:$/);
    assert.equal(createInteraction.mock.callCount(), 1);
    assert.deepEqual(createInteraction.mock.calls[0].arguments[0], { userId: 'u1', message: 'How do I build legs?', response: 'Great question! Do 3 sets of squats.', recipes: null });
  });

  // Regression: thinking tokens ate the 1024-token output cap, so replies came back empty -> 502.
  test('chat requests minimal thinking so the reply is not starved of output tokens', async () => {
    stubModel(['Hi!']);

    await service.chat('hello', [], user);

    const overrides = gemini.getModel.mock.calls[0].arguments[0];
    assert.equal(overrides.thinkingLevel, 'minimal');
    assert.ok(overrides.maxOutputTokens >= 2048);
  });

  test('empty message -> 400 without calling the provider', async () => {
    const generate = stubModel(['unused']);
    for (const msg of ['', '   ', undefined]) {
      const result = await service.chat(msg, [], user);
      assert.equal(result.code, 400);
      assert.equal(result.success, false);
    }
    assert.equal(generate.mock.callCount(), 0);
  });

  test('provider 429 is retried 3 times then mapped to 429 AI_RATE_LIMITED', async () => {
    const generate = stubModel([providerError(429, '[429 Too Many Requests] Resource exhausted')]);
    const result = await service.chat('hi', [], user);
    assert.equal(generate.mock.callCount(), 3);
    assert.equal(result.code, 429);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'AI_RATE_LIMITED');
    assert.equal(createInteraction.mock.callCount(), 0);
  });

  // Regression: an exhausted daily quota (provider asks to wait hours) must not be retried.
  test('provider 429 with a long retryDelay is not retried and reports retryAfter', async () => {
    const quota = providerError(429, '[429] quota exceeded', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '57763s' }]);
    const generate = stubModel([quota]);

    const result = await service.chat('hi', [], user);

    assert.equal(generate.mock.callCount(), 1);
    assert.equal(result.code, 429);
    assert.equal(result.errorCode, 'AI_RATE_LIMITED');
    assert.equal(result.retryAfter, 57763);
  });

  test('provider 429 then success returns the reply after 2 attempts', async () => {
    const generate = stubModel([providerError(429), 'Back online']);
    const result = await service.chat('hi', [], user);
    assert.equal(generate.mock.callCount(), 2);
    assert.equal(result.code, 200);
    assert.equal(result.data.response, 'Back online');
  });

  for (const [label, err, code, errorCode] of [
    ['bad key (400 API_KEY_INVALID)', providerError(400, 'API key not valid. Please pass a valid API key.', [{ reason: 'API_KEY_INVALID' }]), 503, 'AI_AUTH_ERROR'],
    ['forbidden key (403)', providerError(403, '[403 Forbidden] Permission denied'), 503, 'AI_AUTH_ERROR'],
    ['unauthorized (401)', providerError(401), 503, 'AI_AUTH_ERROR'],
    ['provider 500', providerError(500, '[500 Internal Server Error]'), 502, 'AI_PROVIDER_ERROR'],
    ['other 400 (bad request, not a key problem)', providerError(400, 'Invalid JSON payload'), 502, 'AI_PROVIDER_ERROR'],
    ['network error (no status)', new Error('fetch failed'), 502, 'AI_PROVIDER_ERROR'],
  ]) {
    test(`${label} is not retried and maps to ${code} ${errorCode}`, async () => {
      const generate = stubModel([err]);
      const result = await service.chat('hi', [], user);
      assert.equal(generate.mock.callCount(), 1);
      assert.equal(result.code, code);
      assert.equal(result.success, false);
      assert.equal(result.errorCode, errorCode);
      assert.notEqual(result.code, 429);
      assert.ok(!/RATE_LIMITED/.test(result.errorCode));
    });
  }

  test('empty provider text maps to 502 AI_PROVIDER_ERROR', async () => {
    stubModel(['   ']);
    const result = await service.chat('hi', [], user);
    assert.equal(result.code, 502);
    assert.equal(result.errorCode, 'AI_PROVIDER_ERROR');
  });

  test('not configured -> 503 AI_NOT_CONFIGURED, provider never called', async () => {
    mock.method(gemini, 'isAvailable', () => false);
    const generate = stubModel(['unused']);
    const result = await service.chat('hi', [], user);
    assert.equal(result.code, 503);
    assert.equal(result.errorCode, 'AI_NOT_CONFIGURED');
    assert.equal(generate.mock.callCount(), 0);
  });
});
