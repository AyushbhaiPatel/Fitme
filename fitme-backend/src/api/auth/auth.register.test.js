process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { test, describe, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const authDao = require('./auth.dao');
const authRoutes = require('./auth.routes');
const User = require('../user/user.model');

// Mount the real route -> validation -> controller -> service chain, with the same 500 fallback as index.js.
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ success: false, message: 'Something went wrong!' }));

let server;
let baseUrl;
before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});
after(() => new Promise((resolve) => server.close(resolve)));
afterEach(() => mock.restoreAll());

const valid = { email: 'jane@example.com', password: 'Str0ng!Pass', firstName: 'Jane', lastName: 'Doe' };

const post = async (body) => {
  const res = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

// No database: lookups are stubbed, and createUser runs real schema validation without saving.
const stubDao = ({ existingEmails = [], takenUsernames = [] } = {}) => {
  mock.method(authDao, 'findByEmail', async (email) => (existingEmails.includes(email) ? { email } : null));
  mock.method(authDao, 'findByUsername', async (username) => (takenUsernames.includes(username) ? { username } : null));
  return mock.method(authDao, 'createUser', async (payload) => {
    const user = new User(payload);
    await user.validate();
    return user;
  });
};

describe('POST /api/auth/register', () => {
  test('valid registration returns 201 with user and tokens', async () => {
    const create = stubDao();
    const { status, body } = await post(valid);

    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.user.email, 'jane@example.com');
    assert.equal(body.data.user.username, 'jane');
    assert.ok(body.data.tokens.accessToken);
    assert.ok(body.data.tokens.refreshToken);
    assert.equal(create.mock.callCount(), 1);
  });

  test('a local part longer than 30 chars is accepted and the username is truncated', async () => {
    const local = 'a'.repeat(45);
    const create = stubDao();
    const { status, body } = await post({ ...valid, email: `${local}@example.com` });

    assert.equal(status, 201);
    assert.equal(body.data.user.email, `${local}@example.com`);
    assert.equal(body.data.user.username, 'a'.repeat(30));
    assert.equal(create.mock.callCount(), 1);
  });

  test('an email with a 4+ letter TLD such as .test is accepted', async () => {
    stubDao();
    const { status, body } = await post({ ...valid, email: 'someone@example.test' });
    assert.equal(status, 201);
    assert.equal(body.data.user.email, 'someone@example.test');
  });

  test('a short local part gets a username that meets the minimum length', async () => {
    stubDao();
    const { status, body } = await post({ ...valid, email: 'jo@example.com' });
    assert.equal(status, 201);
    assert.ok(body.data.user.username.length >= 3);
  });

  test('a derived username that is already taken is made unique instead of failing', async () => {
    stubDao({ takenUsernames: ['jane'] });
    const { status, body } = await post(valid);
    assert.equal(status, 201);
    assert.notEqual(body.data.user.username, 'jane');
    assert.match(body.data.user.username, /^jane_\w+$/);
  });

  for (const email of ['not-an-email', 'jane@', '@example.com', 'jane@example', 'jane doe@example.com']) {
    test(`malformed email "${email}" returns 400 and saves nothing`, async () => {
      const create = stubDao();
      const { status, body } = await post({ ...valid, email });
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.message, 'Please provide a valid email address');
      assert.equal(body.errors[0].field, 'email');
      assert.equal(create.mock.callCount(), 0);
    });
  }

  test('an email longer than 254 characters returns 400', async () => {
    const create = stubDao();
    const { status, body } = await post({ ...valid, email: `jane@${'a'.repeat(250)}.com` });
    assert.equal(status, 400);
    assert.equal(body.message, 'Email must be at most 254 characters');
    assert.equal(create.mock.callCount(), 0);
  });

  const missing = {
    email: 'Email is required',
    password: 'Password is required',
    firstName: 'First name is required',
    lastName: 'Last name is required',
  };
  for (const [field, message] of Object.entries(missing)) {
    test(`missing ${field} returns 400 "${message}" and saves nothing`, async () => {
      const create = stubDao();
      const body = { ...valid };
      delete body[field];
      const res = await post(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.message, message);
      assert.equal(res.body.errors[0].field, field);
      assert.equal(create.mock.callCount(), 0);
    });
  }

  test('a weak password returns 400 without echoing the password back', async () => {
    const create = stubDao();
    const { status, body } = await post({ ...valid, password: 'short' });
    assert.equal(status, 400);
    assert.equal(body.message, 'Password must be at least 8 characters long');
    assert.ok(!JSON.stringify(body).includes('short"'));
    assert.equal(create.mock.callCount(), 0);
  });

  test('duplicate email returns 409 and saves nothing', async () => {
    const create = stubDao({ existingEmails: ['jane@example.com'] });
    const { status, body } = await post(valid);
    assert.equal(status, 409);
    assert.equal(body.message, 'User with this email already exists');
    assert.equal(create.mock.callCount(), 0);
  });

  test('a duplicate-key error from MongoDB (race) maps to 409, not 500', async () => {
    stubDao();
    mock.method(authDao, 'createUser', async () => {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      err.keyPattern = { email: 1 };
      throw err;
    });
    const { status, body } = await post(valid);
    assert.equal(status, 409);
    assert.equal(body.message, 'User with this email already exists');
  });

  test('a Mongoose ValidationError that slips past the validator maps to 400, not 500', async () => {
    stubDao();
    mock.method(authDao, 'createUser', async (payload) => {
      const user = new User({ ...payload, firstName: 'x'.repeat(51) });
      await user.validate();
      return user;
    });
    const { status, body } = await post(valid);
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.equal(body.errors[0].field, 'firstName');
  });

  test('unexpected errors still return 500', async () => {
    stubDao();
    mock.method(authDao, 'createUser', async () => {
      throw new Error('connection lost');
    });
    const { status } = await post(valid);
    assert.equal(status, 500);
  });
});
