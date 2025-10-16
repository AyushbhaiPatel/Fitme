process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// DELETE /api/user/account through the real app (routes, validator, controller, service, error
// handler). No database: users live in an in-memory map and every model/dao call is stubbed.
const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../../../index');
const User = require('./user.model');
const userDao = require('./user.dao');
const authDao = require('../auth/auth.dao');
const workoutDao = require('../workout/workout.dao');
const WorkoutPlan = require('../workout/workout.model');
const MealPlan = require('../mealplan/mealplan.model');
const AICoachInteraction = require('../aicoach/aicoach.model');
const accountDeletion = require('./user.deletion');
const { generateAccessToken, generateRefreshToken } = require('../../utils/jwt');

const PASSWORD = 'Str0ng!Pass';
let hash;
let server;
let base;
before(async () => {
  hash = await bcrypt.hash(PASSWORD, 4);
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((resolve) => server.close(resolve)));

let users; // id -> User document
let log; // ordered record of every delete call: [label, filterOrId]
let alice;
let bob;
let token;

const makeUser = (email, username, password = hash) => {
  const u = new User({ email, password: 'placeholder', firstName: 'Test', lastName: 'User', username });
  u.password = password; // stored hash, as loaded with select('+password')
  users.set(String(u._id), u);
  return u;
};

beforeEach(() => {
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  accountDeletion.resetAttempts();
  users = new Map();
  log = [];
  alice = makeUser('alice@example.com', 'alice');
  bob = makeUser('bob@example.com', 'bob');
  token = generateAccessToken(alice);

  mock.method(User, 'findById', async (id) => users.get(String(id)) || null);
  mock.method(userDao, 'findByIdWithPassword', async (id) => users.get(String(id)) || null);
  mock.method(userDao, 'deleteById', async (id) => {
    log.push(['user', String(id)]);
    const u = users.get(String(id)) || null;
    users.delete(String(id));
    return u;
  });
  mock.method(workoutDao, 'deleteSessionsForUser', async (id) => { log.push(['sessions', String(id)]); return 0; });
  for (const [label, Model] of [['plans', WorkoutPlan], ['mealplans', MealPlan], ['aicoach', AICoachInteraction]]) {
    mock.method(Model, 'deleteMany', async (filter) => { log.push([label, filter]); return { deletedCount: 0 }; });
  }
});
afterEach(() => mock.restoreAll());

const call = async (method, path, { body, auth = token } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
};

const del = (body, auth) => call('DELETE', '/user/account', { body, auth });

const assertNothingDeleted = () => {
  assert.deepEqual(log, []);
  assert.ok(users.has(String(alice._id)));
  assert.ok(users.has(String(bob._id)));
};

describe('DELETE /api/user/account requires the current password', () => {
  test('no password (or no body) is rejected with 400 and deletes nothing', async () => {
    for (const body of [{}, undefined]) {
      const { status, body: res } = await del(body);
      assert.equal(status, 400);
      assert.equal(res.success, false);
      assert.equal(res.message, 'Password is required to delete your account');
      assert.equal(res.errors[0].field, 'password');
    }
    assertNothingDeleted();
  });

  test('an empty or null password is rejected with 400', async () => {
    for (const password of ['', null]) {
      const { status, body } = await del({ password });
      assert.equal(status, 400);
      assert.equal(body.message, 'Password is required to delete your account');
    }
    assertNothingDeleted();
  });

  test('a non-string password is rejected with 400 and never echoed', async () => {
    for (const password of [12345678, true, ['x'], { $ne: null }]) {
      const { status, body, text } = await del({ password });
      assert.equal(status, 400);
      assert.equal(body.message, 'Password must be a string');
      assert.ok(!text.includes('12345678'));
    }
    assertNothingDeleted();
  });

  test('a wrong password returns 400 INCORRECT_PASSWORD (not 401), deletes nothing, keeps the session', async () => {
    const { status, body, text } = await del({ password: 'Wr0ng!Pass' });
    assert.equal(status, 400);
    assert.deepEqual(body, { code: 400, success: false, message: 'Incorrect password', errorCode: 'INCORRECT_PASSWORD' });
    assert.ok(!text.includes('Wr0ng'));
    assertNothingDeleted();
    assert.equal((await call('GET', '/user/stats')).status, 200);
  });

  test('repeated wrong passwords lock deletion with 429, even for the right password afterwards', async () => {
    for (let i = 0; i < accountDeletion.MAX_ATTEMPTS; i++) {
      assert.equal((await del({ password: `nope-${i}` })).status, 400);
    }
    const { status, body } = await del({ password: PASSWORD });
    assert.equal(status, 429);
    assert.equal(body.errorCode, 'TOO_MANY_ATTEMPTS');
    assertNothingDeleted();

    // The lock is per user: another account is unaffected.
    assert.equal((await del({ password: PASSWORD }, generateAccessToken(bob))).status, 200);
  });

  test('an account without a usable password hash cannot be deleted here (403 REAUTH_REQUIRED)', async () => {
    for (const stored of [undefined, '', 'plaintext-password']) {
      alice.password = stored;
      const { status, body } = await del({ password: PASSWORD });
      assert.equal(status, 403);
      assert.equal(body.errorCode, 'REAUTH_REQUIRED');
      assert.match(body.message, /re-authenticate/);
    }
    assertNothingDeleted();
  });

  test('no bearer token returns 401 and deletes nothing', async () => {
    assert.equal((await del({ password: PASSWORD }, null)).status, 401);
    assertNothingDeleted();
  });
});

describe('successful deletion', () => {
  test('removes every collection for that user id only, user document last', async () => {
    const { status, body } = await del({ password: PASSWORD });
    assert.equal(status, 200);
    assert.deepEqual(body, { code: 200, success: true, message: 'Account deleted successfully', data: null });

    const id = String(alice._id);
    const filter = (f) => (typeof f === 'string' ? f : String(f.userId));
    assert.deepEqual(Object.keys(log.find(([l]) => l === 'plans')[1]), ['userId']);
    for (const [, f] of log) assert.equal(filter(f), id, 'every delete must be scoped to the authenticated user');
    assert.ok(log.every(([, f]) => filter(f) !== String(bob._id)));

    // Dependents, then the user, then a follow-up sweep of the dependents.
    assert.deepEqual(log.map(([l]) => l), [
      'sessions', 'plans', 'mealplans', 'aicoach',
      'user',
      'sessions', 'plans', 'mealplans', 'aicoach',
    ]);
    assert.ok(!users.has(id));
    assert.ok(users.has(String(bob._id)));
  });

  test('a failing dependent delete returns 500, the account survives and a retry succeeds', async () => {
    let failing = true;
    MealPlan.deleteMany.mock.mockImplementation(async (filter) => {
      log.push(['mealplans', filter]);
      if (failing) throw new Error('connection reset');
      return { deletedCount: 1 };
    });

    const first = await del({ password: PASSWORD });
    assert.equal(first.status, 500);
    assert.equal(first.body.success, false);
    assert.ok(!first.text.includes('connection reset'));
    assert.ok(!log.some(([l]) => l === 'user'), 'user document must not be removed after a failure');
    assert.ok(users.has(String(alice._id)));
    assert.equal((await call('GET', '/user/stats')).status, 200, 'account still works after the failed attempt');

    failing = false;
    assert.equal((await del({ password: PASSWORD })).status, 200);
    assert.ok(!users.has(String(alice._id)));
  });

  test('a failure in the post-deletion sweep is logged, not reported (the account is already gone)', async () => {
    let calls = 0;
    AICoachInteraction.deleteMany.mock.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) throw new Error('late failure');
      return { deletedCount: 0 };
    });
    assert.equal((await del({ password: PASSWORD })).status, 200);
    assert.ok(!users.has(String(alice._id)));
    assert.equal(console.error.mock.callCount(), 1);
  });
});

describe('after deletion', () => {
  test('old access token is 401, a second deletion is a clean 401, old refresh token cannot mint tokens', async () => {
    const refreshToken = generateRefreshToken(alice);
    assert.equal((await del({ password: PASSWORD })).status, 200);

    const stats = await call('GET', '/user/stats');
    assert.equal(stats.status, 401);
    assert.equal(stats.body.message, 'Token is valid but user not found.');

    const again = await del({ password: PASSWORD });
    assert.equal(again.status, 401);
    assert.equal(log.filter(([l]) => l === 'user').length, 1);

    const refreshed = await call('POST', '/auth/refresh', { auth: null, body: { refreshToken } });
    assert.equal(refreshed.status, 401);
    assert.equal(refreshed.body.success, false);
    assert.ok(!refreshed.body.data);
  });

  test('concurrent double submits never 500 and leave other accounts alone', async () => {
    const results = await Promise.all([del({ password: PASSWORD }), del({ password: PASSWORD })]);
    for (const r of results) assert.ok([200, 401, 404].includes(r.status), `unexpected ${r.status}`);
    assert.ok(results.some((r) => r.status === 200));
    assert.ok(!users.has(String(alice._id)));
    assert.ok(users.has(String(bob._id)));
  });

  test('the deleted email can register again', async () => {
    assert.equal((await del({ password: PASSWORD })).status, 200);
    const byEmail = (email) => [...users.values()].find((u) => u.email === email) || null;
    mock.method(authDao, 'findByEmail', async (email) => byEmail(email));
    mock.method(authDao, 'findByUsername', async (username) => [...users.values()].find((u) => u.username === username) || null);
    mock.method(authDao, 'createUser', async (payload) => {
      const u = new User(payload);
      await u.validate();
      users.set(String(u._id), u);
      return u;
    });

    const { status, body } = await call('POST', '/auth/register', {
      auth: null,
      body: { email: 'alice@example.com', password: PASSWORD, firstName: 'Alice', lastName: 'Again' },
    });
    assert.equal(status, 201);
    assert.equal(body.data.user.email, 'alice@example.com');
    assert.notEqual(String(body.data.user.id), String(alice._id));
  });
});
