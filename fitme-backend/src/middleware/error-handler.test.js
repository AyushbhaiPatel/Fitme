process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { mapError, errorHandler, fieldLabel } = require('./error-handler');
const User = require('../api/user/user.model');

afterEach(() => mock.restoreAll());

const noLeak = (body, ...needles) => {
  const text = JSON.stringify(body);
  for (const n of needles) assert.ok(!text.includes(n), `response leaked ${JSON.stringify(n)}: ${text}`);
  assert.ok(!/stack|\bat .+\.js:\d+/.test(text), `response leaked a stack: ${text}`);
};

describe('mapError', () => {
  test('Mongoose ValidationError -> 400 with first message and field list, values never echoed', () => {
    const doc = new User({ email: 'jane@example.com', password: 'abc', firstName: 'Jane', lastName: 'Doe', gender: 'zzz-secret', weight: 9000 });
    const err = doc.validateSync();
    const body = mapError(err);

    assert.equal(body.code, 400);
    assert.equal(body.success, false);
    assert.equal(typeof body.message, 'string');
    assert.equal(body.message, body.errors[0].message);
    const byField = Object.fromEntries(body.errors.map((e) => [e.field, e.message]));
    assert.equal(byField.password, 'Password must be at least 6 characters');
    assert.equal(byField.gender, 'Invalid gender value');
    assert.equal(byField.weight, 'Weight must be at most 500');
    noLeak(body, 'abc', 'zzz-secret', '9000');
  });

  test('custom schema messages are kept when they do not echo the value', () => {
    const err = new User({ email: 'not-an-email', password: 'Secret123!', firstName: 'J', lastName: 'D' }).validateSync();
    const body = mapError(err);
    assert.equal(body.code, 400);
    assert.equal(body.errors.find((e) => e.field === 'email').message, 'Please enter a valid email');
  });

  test('cast errors inside a ValidationError -> "Invalid <field>"', () => {
    let err;
    try { User.castObject({ height: 'tall', longestStreak: 'many' }); } catch (e) { err = e; }
    const body = mapError(err);
    assert.equal(body.code, 400);
    assert.deepEqual(body.errors.map((e) => e.message).sort(), ['Invalid height', 'Invalid longest streak']);
    noLeak(body, 'tall', 'many', 'Cast to');
  });

  test('CastError -> 400 "Invalid id"', () => {
    const body = mapError(new mongoose.Error.CastError('ObjectId', 'nope', '_id'));
    assert.deepEqual(body, { code: 400, success: false, message: 'Invalid id', errors: [{ field: '_id', message: 'Invalid id' }] });
  });

  test('duplicate key 11000 -> 409 naming the field, not the value', () => {
    const err = Object.assign(new Error('E11000 duplicate key error collection: fitme.users index: email_1 dup key: { email: "secret@x.io" }'), {
      name: 'MongoServerError', code: 11000, keyPattern: { email: 1 }, keyValue: { email: 'secret@x.io' },
    });
    const body = mapError(err);
    assert.equal(body.code, 409);
    assert.equal(body.message, 'Email is already taken');
    assert.deepEqual(body.errors, [{ field: 'email', message: 'Email is already taken' }]);
    noLeak(body, 'secret@x.io', 'E11000', 'fitme.users');

    const other = mapError({ code: 11000, keyPattern: { planName: 1 } });
    assert.equal(other.message, 'A record with this plan name already exists');
    assert.equal(mapError({ code: 11000 }).message, 'Resource already exists');
  });

  test('body-parser JSON syntax error -> 400 without echoing the body', () => {
    const err = Object.assign(new SyntaxError('Unexpected token in JSON: {"password":"hunter2'), {
      type: 'entity.parse.failed', status: 400, expose: true, body: '{"password":"hunter2',
    });
    const body = mapError(err);
    assert.deepEqual(body, { code: 400, success: false, message: 'Malformed JSON in request body' });
  });

  test('payload too large -> 413', () => {
    const body = mapError(Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413, expose: true }));
    assert.deepEqual(body, { code: 413, success: false, message: 'Request body is too large' });
  });

  test('JWT errors -> 401', () => {
    let expired;
    try { jwt.verify(jwt.sign({ a: 1, exp: Math.floor(Date.now() / 1000) - 60 }, 's'), 's'); } catch (e) { expired = e; }
    assert.equal(mapError(expired).code, 401);
    assert.equal(mapError(expired).errorCode, 'TOKEN_EXPIRED');

    let bad;
    try { jwt.verify('garbage', 's'); } catch (e) { bad = e; }
    assert.equal(mapError(bad).code, 401);
    assert.equal(mapError(bad).errorCode, 'INVALID_TOKEN');
  });

  test('other exposed 4xx http errors keep their status with a generic phrase', () => {
    const body = mapError(Object.assign(new Error('details'), { status: 415, expose: true }));
    assert.deepEqual(body, { code: 415, success: false, message: 'Unsupported Media Type' });
  });

  test('unexpected errors -> generic 500 with no details', () => {
    const err = new Error('connect ECONNREFUSED 10.0.0.5:27017 at /srv/app/src/database/conn.js');
    const body = mapError(err);
    assert.deepEqual(body, { code: 500, success: false, message: 'Something went wrong!', error: 'Internal server error' });
    assert.equal(mapError(null).code, 500);
    assert.equal(mapError('boom').code, 500);
    // A 5xx http error, even if marked exposed, is still generic.
    assert.equal(mapError(Object.assign(new Error('x'), { status: 503, expose: true })).code, 500);
  });

  test('fieldLabel humanizes paths', () => {
    assert.equal(fieldLabel('_id'), 'id');
    assert.equal(fieldLabel('firstName'), 'First name');
    assert.equal(fieldLabel('workoutHistory.0.durationSeconds'), 'Duration seconds');
    assert.equal(fieldLabel('max_prep_time'), 'Max prep time');
  });
});

describe('errorHandler middleware', () => {
  const fakeRes = () => {
    const res = { headersSent: false, statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };

  test('writes the mapped envelope and logs 500s server-side only', () => {
    const errLog = mock.method(console, 'error', () => {});
    const res = fakeRes();
    errorHandler(new Error('db exploded'), { method: 'GET', originalUrl: '/api/x?token=abc' }, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Something went wrong!');
    assert.equal(errLog.mock.callCount(), 1);
    // Query strings (which may carry tokens) are not logged.
    assert.ok(!String(errLog.mock.calls[0].arguments[0]).includes('token=abc'));
  });

  test('4xx are logged as one-line warnings', () => {
    const warn = mock.method(console, 'warn', () => {});
    const res = fakeRes();
    errorHandler(new mongoose.Error.CastError('ObjectId', 'x', '_id'), { method: 'GET', originalUrl: '/api/workouts/x' }, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(warn.mock.callCount(), 1);
  });

  test('delegates to next() if headers were already sent', () => {
    const res = fakeRes();
    res.headersSent = true;
    let forwarded;
    errorHandler(new Error('late'), { method: 'GET', originalUrl: '/' }, res, (e) => { forwarded = e; });
    assert.equal(forwarded.message, 'late');
    assert.equal(res.statusCode, null);
  });
});
