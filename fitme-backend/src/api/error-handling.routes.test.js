process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Drives the real app from index.js (routes, body parser, global error handler) on an ephemeral port.
// No database: every DAO / model call the tested routes reach is stubbed.
const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../../index');
const User = require('./user/user.model');
const userDao = require('./user/user.dao');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');

let server;
let base;
before(async () => {
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((resolve) => server.close(resolve)));

let user;
let token;
beforeEach(() => {
  // Keep test output clean; the handler logs server-side.
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  user = new User({ email: 'jane@example.com', password: 'Str0ng!Pass', firstName: 'Jane', lastName: 'Doe', username: 'jane' });
  token = generateAccessToken(user);
  mock.method(User, 'findById', async (id) => (String(id) === String(user._id) ? user : null));
});
afterEach(() => mock.restoreAll());

const call = async (method, path, { body, raw, auth = true, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
};

const assertNoLeak = (text, ...needles) => {
  for (const n of needles) assert.ok(!text.includes(n), `response leaked ${JSON.stringify(n)}: ${text}`);
  assert.ok(!/"stack"|\.js:\d+|node_modules/.test(text), `response leaked internals: ${text}`);
};

describe('body parsing', () => {
  test('malformed JSON returns 400, not 500, and does not echo the body', async () => {
    const { status, body, text } = await call('POST', '/auth/login', { auth: false, raw: '{"email":"a@b.co","password":"hunter2' });
    assert.equal(status, 400);
    assert.deepEqual(body, { code: 400, success: false, message: 'Malformed JSON in request body' });
    assertNoLeak(text, 'hunter2');
  });

  test('a body over the 10mb limit returns 413', async () => {
    const { status, body } = await call('PUT', '/user/profile', { raw: JSON.stringify({ bio: 'x'.repeat(11 * 1024 * 1024) }) });
    assert.equal(status, 413);
    assert.equal(body.code, 413);
    assert.equal(body.success, false);
  });
});

describe('authentication', () => {
  test('a garbage bearer token on a protected route returns 401', async () => {
    token = 'not.a.jwt';
    const { status, body } = await call('GET', '/user/stats');
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.equal(body.code, 'INVALID_TOKEN');
  });

  test('an expired (stale session) token returns 401 TOKEN_EXPIRED', async () => {
    token = jwt.sign(
      { userId: user._id, type: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET,
      { issuer: 'fitness-tracker-api', audience: 'fitness-tracker-client' }
    );
    const { status, body } = await call('GET', '/user/stats');
    assert.equal(status, 401);
    assert.equal(body.code, 'TOKEN_EXPIRED');
  });

  test('/auth/refresh with an invalid refresh token returns 401, not 500', async () => {
    const { status, body } = await call('POST', '/auth/refresh', { auth: false, body: { refreshToken: 'garbage' } });
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid refresh token.');
  });

  test('/auth/refresh with a non-string or access token returns 401', async () => {
    assert.equal((await call('POST', '/auth/refresh', { auth: false, body: { refreshToken: 12345 } })).status, 401);
    assert.equal((await call('POST', '/auth/refresh', { auth: false, body: { refreshToken: token } })).status, 401);
  });

  test('/auth/refresh with a valid refresh token still returns 200', async () => {
    const { status, body } = await call('POST', '/auth/refresh', { auth: false, body: { refreshToken: generateRefreshToken(user) } });
    assert.equal(status, 200);
    assert.ok(body.data.tokens.accessToken);
  });

  test('login with a non-string password returns 400 without echoing it', async () => {
    const { status, body, text } = await call('POST', '/auth/login', { auth: false, body: { email: 'jane@example.com', password: 987654321 } });
    assert.equal(status, 400);
    assert.equal(body.message, 'Password must be a string');
    assertNoLeak(text, '987654321');
  });

  test('login with a missing password keeps its 400 contract', async () => {
    const { status, body } = await call('POST', '/auth/login', { auth: false, body: { email: 'jane@example.com' } });
    assert.equal(status, 400);
    assert.equal(body.message, 'Password is required');
  });
});

describe('PUT /user/profile', () => {
  test('unknown enum value is rejected up front with 400', async () => {
    const update = mock.method(userDao, 'updateById', async () => user);
    const { status, body } = await call('PUT', '/user/profile', { body: { activityLevel: 'couch-potato' } });
    assert.equal(status, 400);
    assert.equal(body.message, 'Invalid activity level value');
    assert.equal(body.errors[0].field, 'activityLevel');
    assert.equal(update.mock.callCount(), 0);
  });

  test('out-of-range number is rejected with 400', async () => {
    const { status, body } = await call('PUT', '/user/profile', { body: { height: 9999 } });
    assert.equal(status, 400);
    assert.equal(body.message, 'Height must be between 50 and 300 cm');
  });

  test('a Mongoose ValidationError thrown from the service (runValidators) returns 400 with field errors', async () => {
    // The profile allowlist drops non-profile fields, so raise the real Mongoose cast error from the dao directly.
    mock.method(userDao, 'updateById', async () => { User.castObject({ longestStreak: 'lots' }); return user; });
    const { status, body, text } = await call('PUT', '/user/profile', { body: { firstName: 'Jane' } });
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid longest streak');
    assert.deepEqual(body.errors, [{ field: 'longestStreak', message: 'Invalid longest streak' }]);
    assertNoLeak(text, 'Cast to', 'lots');
  });

  test('a duplicate-key race on username returns 409', async () => {
    mock.method(userDao, 'findByUsername', async () => null);
    mock.method(userDao, 'updateById', async () => {
      throw Object.assign(new Error('E11000 duplicate key error dup key: { username: "jane2" }'), { name: 'MongoServerError', code: 11000, keyPattern: { username: 1 }, keyValue: { username: 'jane2' } });
    });
    const { status, body, text } = await call('PUT', '/user/profile', { body: { username: 'jane2' } });
    assert.equal(status, 409);
    assert.equal(body.message, 'Username is already taken');
    assertNoLeak(text, 'E11000');
  });

  test('a genuine unexpected error still returns 500 without details', async () => {
    mock.method(userDao, 'updateById', async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:27017 /srv/fitme/src/database/conn.js'); });
    const { status, body, text } = await call('PUT', '/user/profile', { body: { firstName: 'Janet' } });
    assert.equal(status, 500);
    assert.deepEqual(body, { code: 500, success: false, message: 'Something went wrong!', error: 'Internal server error' });
    assertNoLeak(text, 'ECONNREFUSED', '10.1.2.3', '/srv/fitme');
  });

  test('a valid update still returns 200', async () => {
    mock.method(userDao, 'updateById', async () => user);
    const { status, body } = await call('PUT', '/user/profile', { body: { firstName: 'Janet', activityLevel: 'very-active' } });
    assert.equal(status, 200);
    assert.equal(body.message, 'Profile updated successfully');
  });
});

describe('other user routes', () => {
  test('duplicate email on PUT /user/email (race) returns 409 without echoing the email', async () => {
    mock.method(user, 'comparePassword', async () => true);
    mock.method(userDao, 'findByIdWithPassword', async () => user);
    mock.method(userDao, 'findByEmail', async () => null);
    mock.method(userDao, 'saveUser', async () => {
      throw Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 }, keyValue: { email: 'taken.secret@example.com' } });
    });
    const { status, body, text } = await call('PUT', '/user/email', { body: { newEmail: 'taken.secret@example.com', password: 'Str0ng!Pass' } });
    assert.equal(status, 409);
    assert.equal(body.message, 'Email is already taken');
    assertNoLeak(text, 'taken.secret');
  });

  test('DELETE /user/account with a non-string password returns 400', async () => {
    const del = mock.method(userDao, 'deleteById', async () => user);
    const { status, body } = await call('DELETE', '/user/account', { body: { password: 1234 } });
    assert.equal(status, 400);
    assert.equal(body.message, 'Password must be a string');
    assert.equal(del.mock.callCount(), 0);
  });

  test('PUT /user/profile-photo with missing data keeps 400 "Profile photo data is required"', async () => {
    const { status, body } = await call('PUT', '/user/profile-photo', { body: {} });
    assert.equal(status, 400);
    assert.equal(body.message, 'Profile photo data is required');
  });

  test('PUT /user/profile-photo with an array payload returns 400, not 500', async () => {
    const { status } = await call('PUT', '/user/profile-photo', { body: { profilePhoto: ['data:image/png;base64,AAAA'] } });
    assert.equal(status, 400);
  });
});

describe('malformed identifiers', () => {
  for (const [method, path] of [['GET', '/mealplan/not-an-id'], ['DELETE', '/mealplan/not-an-id'], ['POST', '/mealplan/regenerate/123']]) {
    test(`${method} ${path} returns 400 "Invalid meal plan id"`, async () => {
      const { status, body } = await call(method, path);
      assert.equal(status, 400);
      assert.equal(body.message, 'Invalid meal plan id');
      assert.equal(body.errors[0].field, 'planId');
    });
  }

  test('a CastError from an unvalidated route (GET /workouts/:id) is mapped centrally to 400', async () => {
    // Workout routes are being restructured elsewhere and may add their own id validator; either way it is a 400.
    const { status, body } = await call('GET', '/workouts/not-an-id');
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /^Invalid /);
  });
});

describe('meal plan payloads', () => {
  test('missing food_items returns 400', async () => {
    const { status, body } = await call('POST', '/mealplan/nutrition/analyze', { body: {} });
    assert.equal(status, 400);
    assert.equal(body.message, 'food_items array is required');
  });

  test('non-string food items return 400, not 500', async () => {
    const { status } = await call('POST', '/mealplan/nutrition/analyze', { body: { food_items: [{ name: 'rice' }, 42] } });
    assert.equal(status, 400);
  });

  test('a non-array dietary_preferences returns 400 before calling the AI', async () => {
    const { status, body } = await call('POST', '/mealplan/generate', { body: { dietary_preferences: 'vegan' } });
    assert.equal(status, 400);
    assert.equal(body.message, 'Dietary preferences must be an array');
  });

  test('out-of-range numbers in user_profile return 400', async () => {
    const { status, body } = await call('POST', '/mealplan/generate', { body: { user_profile: { age: 500 } } });
    assert.equal(status, 400);
    assert.equal(body.message, 'Age must be between 13 and 120');
  });

  test('invalid pagination returns 400', async () => {
    assert.equal((await call('GET', '/mealplan?limit=abc')).status, 400);
    assert.equal((await call('GET', '/mealplan?skip=-5')).status, 400);
  });
});

test('unknown routes keep the 404 contract', async () => {
  const { status, body } = await call('GET', '/does-not-exist', { auth: false });
  assert.equal(status, 404);
  assert.deepEqual(body, { success: false, message: 'Route not found' });
});
