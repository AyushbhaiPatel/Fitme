const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const gemini = require('../../config/gemini');
const workoutDao = require('./workout.dao');
const service = require('./workout.service');
const { undoUserMigration } = require('./workout.migration');

describe('generateWorkoutPlan provider failures are distinguishable', () => {
  const URL = 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent';
  const providerError = (status, message = `[${status}] provider error`, errorDetails) =>
    Object.assign(new Error(`[GoogleGenerativeAI Error]: Error fetching from ${URL}: ${message}`), { status, statusText: '', errorDetails });
  const fetchFailure = (cause) => new Error(`[GoogleGenerativeAI Error]: Error fetching from ${URL}: ${cause}`);
  // Shape of the 429 observed on 2026-11-14 (daily free-tier quota, limit 20, retry in ~16h).
  const dailyQuotaDetails = [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '56641s' },
  ];

  beforeEach(() => {
    mock.method(gemini, 'isAvailable', () => true);
    mock.method(workoutDao, 'findUserById', async () => ({}));
    mock.method(console, 'error', () => {});
  });
  afterEach(() => mock.restoreAll());

  const run = async (impl) => {
    const generate = mock.method(gemini, 'generateContent', impl);
    const res = await service.generateWorkoutPlan('u1', {});
    return { res, generate };
  };
  const rejectWith = (err) => async () => { throw err; };

  for (const [label, err, code, errorCode] of [
    ['daily quota exhausted (429, retry in ~16h)', providerError(429, 'You exceeded your current quota', dailyQuotaDetails), 503, 'AI_QUOTA_EXCEEDED'],
    ['per-day quota without RetryInfo', providerError(429, 'quota', [dailyQuotaDetails[0]]), 503, 'AI_QUOTA_EXCEEDED'],
    ['short-lived rate limit (429, retry in 5s)', providerError(429, 'rate', [{ retryDelay: '5s' }]), 429, 'AI_RATE_LIMITED'],
    ['429 without details', providerError(429), 429, 'AI_RATE_LIMITED'],
    ['invalid key (400 API_KEY_INVALID)', providerError(400, 'API key not valid. Please pass a valid API key.', [{ reason: 'API_KEY_INVALID' }]), 503, 'AI_AUTH_ERROR'],
    ['401', providerError(401), 503, 'AI_AUTH_ERROR'],
    ['403', providerError(403), 503, 'AI_AUTH_ERROR'],
    ['unknown / retired model (404)', providerError(404, 'models/gemini-x is not found for API version v1beta'), 503, 'AI_MODEL_UNAVAILABLE'],
    ['request aborted by timeout', fetchFailure('This operation was aborted'), 504, 'AI_TIMEOUT'],
    ['provider deadline (504)', providerError(504, 'Deadline exceeded'), 504, 'AI_TIMEOUT'],
    ['network failure', fetchFailure('fetch failed'), 503, 'AI_UNAVAILABLE'],
    ['safety block', Object.assign(new Error('[GoogleGenerativeAI Error]: Candidate was blocked due to SAFETY'), { response: { candidates: [{ finishReason: 'SAFETY' }] } }), 502, 'AI_RESPONSE_BLOCKED'],
    ['provider 500', providerError(500), 502, 'AI_PROVIDER_ERROR'],
    ['unknown error', new Error('boom'), 502, 'AI_PROVIDER_ERROR'],
  ]) {
    test(`${label} -> ${code} ${errorCode}, no plan, no provider text`, async () => {
      const { res, generate } = await run(rejectWith(err));
      assert.equal(generate.mock.callCount(), 1);
      assert.equal(res.success, false);
      assert.equal(res.code, code);
      assert.equal(res.errorCode, errorCode);
      assert.equal(res.data, undefined);
      assert.doesNotMatch(res.message, /googleapis|GoogleGenerativeAI|free_tier|quotaId|API key|gemini/i);
    });
  }

  test('the daily quota response says so and carries the provider retry delay', async () => {
    const { res } = await run(rejectWith(providerError(429, 'q', dailyQuotaDetails)));
    assert.match(res.message, /daily AI quota has been reached/);
    assert.equal(res.retryAfter, 56641);
  });

  test('a short rate limit carries its own retry delay', async () => {
    const { res } = await run(rejectWith(providerError(429, 'r', [{ retryDelay: '5s' }])));
    assert.equal(res.retryAfter, 5);
    assert.match(res.message, /busy/);
  });

  for (const [label, text] of [
    ['malformed JSON', '{"days": [{"exercises": [{"name": "Squat"'],
    ['empty reply', ''],
    ['prose', 'Sorry, I cannot help with that.'],
    ['no usable days', '{"days":[{"exercises":[]}]}'],
  ]) {
    test(`invalid model output (${label}) -> 502 AI_INVALID_RESPONSE, never a substitute plan`, async () => {
      const { res } = await run(async () => text);
      assert.equal(res.code, 502);
      assert.equal(res.errorCode, 'AI_INVALID_RESPONSE');
      assert.equal(res.data, undefined);
    });
  }

  test('not configured -> 503 AI_NOT_CONFIGURED without calling Gemini', async () => {
    mock.method(gemini, 'isAvailable', () => false);
    const { res, generate } = await run(async () => '{}');
    assert.equal(res.code, 503);
    assert.equal(res.errorCode, 'AI_NOT_CONFIGURED');
    assert.equal(generate.mock.callCount(), 0);
  });
});

describe('migration undo re-reads the embedded history before deleting', () => {
  const user = { _id: 'u1', workoutHistory: [{ _id: 'a' }, { _id: 'b' }] };
  const makeDao = (currentIds) => {
    const deleted = [];
    return {
      deleted,
      findSessionIdsBySource: async () => ['a', 'b'],
      readEmbeddedIds: async () => currentIds,
      deleteSessionsByIds: async (_userId, ids) => { deleted.push(...ids); return ids.length; },
    };
  };

  test('a session whose embedded entry was trimmed after the snapshot is kept', async () => {
    const dao = makeDao(['a']); // 'b' was trimmed from the cache since the cursor read the user
    const report = await undoUserMigration(user, { apply: true, dao, readEmbeddedIds: dao.readEmbeddedIds });
    assert.deepEqual(dao.deleted, ['a']);
    assert.equal(report.toDelete, 1);
    assert.equal(report.keptNotInEmbedded, 1);
  });

  test('a dry run uses the snapshot and deletes nothing', async () => {
    const dao = makeDao([]);
    const report = await undoUserMigration(user, { apply: false, dao, readEmbeddedIds: dao.readEmbeddedIds });
    assert.deepEqual(dao.deleted, []);
    assert.equal(report.toDelete, 2);
    assert.equal(report.deleted, 0);
  });
});
