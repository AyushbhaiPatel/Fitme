const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Set before requiring the app: index.js runs dotenv, which never overrides existing vars.
process.env.JWT_SECRET = 'aicoach-routes-test-secret';
process.env.GEMINI_API_KEY = ''; // no real Gemini client
process.env.RATE_LIMIT_MAX = '1000';
mock.method(console, 'warn', () => {});

const app = require('../../../index');
const User = require('../user/user.model');
const gemini = require('../../config/gemini');
const aicoachDao = require('./aicoach.dao');
const { generateAccessToken } = require('../../utils/jwt');
const { createChatLimiter } = require('./aicoach.routes');

const listen = (expressApp) =>
  new Promise((resolve) => {
    const server = expressApp.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });

const close = (server) => new Promise((resolve) => server.close(resolve));

const postJson = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const stubModel = (steps) => {
  const generate = mock.fn(async () => {
    const step = steps[Math.min(generate.mock.callCount(), steps.length - 1)];
    if (step instanceof Error) throw step;
    return { response: Promise.resolve({ text: () => step }) };
  });
  mock.method(gemini, 'getModel', () => ({ generateContent: generate }));
  return generate;
};

describe('POST /api/aicoach/chat through the real app (DB and Gemini mocked)', () => {
  const users = {
    u1: { _id: 'u1', email: 'a@example.test', username: 'a', firstName: 'Ann' },
    u2: { _id: 'u2', email: 'b@example.test', username: 'b', firstName: 'Ben' },
  };
  const auth = (id) => ({ Authorization: `Bearer ${generateAccessToken(users[id])}` });
  let server;
  let base;
  const savedRetry = { ...gemini.retryConfig };

  before(async () => {
    ({ server, base } = await listen(app));
  });

  after(async () => {
    await close(server);
  });

  beforeEach(() => {
    gemini.retryConfig.baseDelayMs = 0;
    mock.method(console, 'error', () => {});
    mock.method(User, 'findById', async (id) => users[id] || null);
    mock.method(gemini, 'isAvailable', () => true);
    mock.method(aicoachDao, 'createInteraction', async (p) => ({ ...p, created_at: '2026-01-01T00:00:00.000Z' }));
  });

  afterEach(() => {
    Object.assign(gemini.retryConfig, savedRetry);
    mock.restoreAll();
  });

  test('returns 200 with the reply in the { code, success, message, data } envelope', async () => {
    stubModel(['Do **squats**.']);
    const res = await postJson(`${base}/api/aicoach/chat`, { message: 'Leg day?', conversationHistory: [] }, auth('u1'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.code, 200);
    assert.equal(body.data.response, 'Do squats.');
    assert.equal(body.data.recipes, null);
  });

  test('requires authentication', async () => {
    const generate = stubModel(['unused']);
    const res = await postJson(`${base}/api/aicoach/chat`, { message: 'hi' });
    assert.equal(res.status, 401);
    assert.equal(generate.mock.callCount(), 0);
  });

  test('provider 429 after retries surfaces as HTTP 429 AI_RATE_LIMITED', async () => {
    const generate = stubModel([Object.assign(new Error('[429] exhausted'), { status: 429 })]);
    const res = await postJson(`${base}/api/aicoach/chat`, { message: 'hi' }, auth('u2'));
    assert.equal(res.status, 429);
    assert.equal((await res.json()).errorCode, 'AI_RATE_LIMITED');
    assert.equal(generate.mock.callCount(), 3);
  });

  // Runs last: it exhausts the per-user chat quota of the module-level limiter (20/min) for u1.
  test('default chat limiter allows 20 messages/min per user, blocks the 21st, and other users are unaffected', async () => {
    stubModel(['ok']);
    // u1 already used 1 request above; u2 used 1
    for (let i = 0; i < 19; i++) {
      const res = await postJson(`${base}/api/aicoach/chat`, { message: `msg ${i}` }, auth('u1'));
      assert.equal(res.status, 200, `request ${i + 2} should be allowed`);
    }
    const blocked = await postJson(`${base}/api/aicoach/chat`, { message: 'one too many' }, auth('u1'));
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).errorCode, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.match(blocked.headers.get('access-control-expose-headers') || '', /Retry-After/i);

    const other = await postJson(`${base}/api/aicoach/chat`, { message: 'hi' }, auth('u2'));
    assert.equal(other.status, 200);
  });
});

describe('createChatLimiter (isolated)', () => {
  let server;
  let base;

  before(async () => {
    const limited = express();
    limited.use(express.json());
    // Fake auth: same IP for everyone, user taken from a header
    limited.use((req, res, next) => {
      if (req.get('x-user')) req.userId = req.get('x-user');
      next();
    });
    limited.post('/chat', createChatLimiter({ windowMs: 60 * 1000, max: 3 }), (req, res) => res.json({ ok: true }));
    ({ server, base } = await listen(limited));
  });

  after(async () => {
    await close(server);
  });

  test('user A gets 3 OKs then 429 RATE_LIMITED with Retry-After; user B on the same IP is still allowed', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await postJson(`${base}/chat`, {}, { 'x-user': 'A' });
      assert.equal(res.status, 200, `request ${i + 1} should be allowed`);
    }
    const blocked = await postJson(`${base}/chat`, {}, { 'x-user': 'A' });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { success: false, message: 'Too many chat requests. Try again in a minute.', errorCode: 'RATE_LIMITED' });
    const retryAfter = Number(blocked.headers.get('retry-after'));
    assert.ok(retryAfter > 0 && retryAfter <= 60, `Retry-After was ${blocked.headers.get('retry-after')}`);

    for (let i = 0; i < 3; i++) {
      const res = await postJson(`${base}/chat`, {}, { 'x-user': 'B' });
      assert.equal(res.status, 200, `user B request ${i + 1} should be allowed`);
    }
    assert.equal((await postJson(`${base}/chat`, {}, { 'x-user': 'B' })).status, 429);
  });

  test('requests without a user id fall back to the IP key', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await postJson(`${base}/chat`, {})).status, 200);
    assert.equal((await postJson(`${base}/chat`, {})).status, 429);
    // A user id is a separate bucket from the IP bucket
    assert.equal((await postJson(`${base}/chat`, {}, { 'x-user': 'C' })).status, 200);
  });
});
