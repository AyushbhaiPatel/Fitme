process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// PUT /api/user/profile through the real app (routes, validator, controller, service, error
// handler). No database: User model calls are stubbed and the update document handed to
// User.findByIdAndUpdate is captured so the test can assert exactly what would be written.
const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../../index');
const User = require('./user.model');
const userService = require('./user.service');
const { generateAccessToken } = require('../../utils/jwt');

let server;
let base;
before(async () => {
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const ALLOWED = [
  'firstName', 'lastName', 'username', 'dateOfBirth', 'gender', 'height', 'weight', 'activityLevel',
  'fitnessGoals', 'location', 'goalWeight', 'profilePhoto', 'bio', 'fitnessExperience', 'workoutFrequency',
  'workoutDuration', 'dietaryPreference', 'preferredWorkouts', 'targetMuscleGain', 'currentStrengthLevel',
];
const FORBIDDEN = [
  'password', 'email', '_id', 'createdAt', 'updatedAt', 'created_at', 'updated_at',
  'totalWorkouts', 'totalCaloriesBurned', 'totalWorkoutTimeSeconds', 'totalWorkoutTimeMinutes',
  'averageWorkoutTimeMinutes', 'workoutHistory', 'workoutCacheTrimEpoch',
  'longestStreak', 'currentStreak', 'achievements', 'lastLoginAt',
];
const FAKE_HASH = '$2a$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234';
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let user;
let token;
let updates; // every update document passed to User.findByIdAndUpdate

beforeEach(() => {
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  user = new User({ email: 'alice@example.com', password: 'placeholder', firstName: 'Alice', lastName: 'Smith', username: 'alice' });
  token = generateAccessToken(user);
  updates = [];
  mock.method(User, 'findById', async (id) => (String(id) === String(user._id) ? user : null));
  mock.method(User, 'findOne', async () => null); // username availability check: never taken
  mock.method(User, 'findByIdAndUpdate', async (id, update, options) => {
    updates.push({ id: String(id), update, options });
    return user;
  });
});
afterEach(() => mock.restoreAll());

const put = async (body) => {
  const res = await fetch(`${base}/user/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
};

// Every write must be exactly { $set: { <allowlisted fields>, profileCompleted: true } }.
const assertSafeUpdate = (update) => {
  assert.deepEqual(Object.keys(update), ['$set'], `unexpected top-level keys: ${Object.keys(update)}`);
  const set = update.$set;
  assert.equal(set.profileCompleted, true);
  for (const key of Object.keys(set)) {
    assert.ok(key === 'profileCompleted' || ALLOWED.includes(key), `non-allowlisted key written: ${key}`);
    assert.ok(!key.startsWith('$') && !key.includes('.'), `operator or dotted key written: ${key}`);
  }
  for (const key of FORBIDDEN) assert.ok(!(key in set), `forbidden key written: ${key}`);
  return set;
};

const onlyUpdate = () => {
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, String(user._id));
  return updates[0].update;
};

describe('PUT /user/profile: mass-assignment protection', () => {
  test('top-level $set/$unset/$inc/$push/$rename are ignored', async () => {
    const { status } = await put({
      firstName: 'Alice',
      $set: { password: FAKE_HASH, email: 'attacker@example.com', totalWorkouts: 999999 },
      $unset: { totalWorkoutTimeSeconds: 1, password: 1 },
      $inc: { totalCaloriesBurned: 1e9, workoutCacheTrimEpoch: 1 },
      $push: { workoutHistory: { caloriesBurned: 1e6 } },
      $rename: { email: 'oldEmail' },
      $setOnInsert: { email: 'x@example.com' },
    });
    assert.equal(status, 200);
    const set = assertSafeUpdate(onlyUpdate());
    assert.deepEqual(set, { firstName: 'Alice', profileCompleted: true });
  });

  test('plain sensitive and non-profile fields are dropped', async () => {
    const { status } = await put({
      lastName: 'Jones',
      password: FAKE_HASH,
      email: 'attacker@example.com',
      _id: '507f1f77bcf86cd799439011',
      totalWorkouts: 999999,
      totalCaloriesBurned: 1,
      totalWorkoutTimeSeconds: 1,
      totalWorkoutTimeMinutes: 1,
      averageWorkoutTimeMinutes: 1,
      workoutHistory: [{ caloriesBurned: 1e6 }],
      workoutCacheTrimEpoch: 0,
      longestStreak: 999,
      currentStreak: 999,
      achievements: 999,
      lastLoginAt: '2020-01-01T00:00:00.000Z',
      created_at: '2000-01-01T00:00:00.000Z',
      updated_at: '2000-01-01T00:00:00.000Z',
      createdAt: '2000-01-01T00:00:00.000Z',
      profileCompleted: false,
      isEmailVerified: true,
    });
    assert.equal(status, 200);
    const set = assertSafeUpdate(onlyUpdate());
    assert.deepEqual(set, { lastName: 'Jones', profileCompleted: true });
  });

  test('dotted paths are dropped', async () => {
    const { status } = await put({
      bio: 'hello',
      'workoutHistory.0.caloriesBurned': 1e6,
      'password.x': 'y',
      'email.0': 'z',
      'firstName.x': 'y',
    });
    assert.equal(status, 200);
    const set = assertSafeUpdate(onlyUpdate());
    assert.deepEqual(set, { bio: 'hello', profileCompleted: true });
  });

  test('a body with only disallowed keys still writes nothing but profileCompleted', async () => {
    const { status } = await put({ $set: { password: FAKE_HASH }, email: 'attacker@example.com' });
    assert.equal(status, 200);
    assert.deepEqual(assertSafeUpdate(onlyUpdate()), { profileCompleted: true });
  });

  test('update options still run schema validators and return the new document', async () => {
    await put({ firstName: 'Alice' });
    assert.deepEqual(updates[0].options, { new: true, runValidators: true });
  });
});

describe('PUT /user/profile: legitimate updates still save', () => {
  test('every allowlisted field passes through unchanged', async () => {
    const body = {
      firstName: 'Alice',
      lastName: 'Smith',
      username: 'alice_new',
      dateOfBirth: '1990-05-15',
      gender: 'female',
      height: 170,
      weight: 65,
      activityLevel: 'moderately-active',
      fitnessGoals: ['weight-loss'],
      location: 'Berlin',
      goalWeight: 60,
      profilePhoto: PHOTO,
      bio: 'Runner',
      fitnessExperience: 'intermediate',
      workoutFrequency: '3-4',
      workoutDuration: '45-60',
      dietaryPreference: 'Vegetarian',
      preferredWorkouts: 'Cardio,Yoga',
      targetMuscleGain: 5,
      currentStrengthLevel: 'Intermediate',
    };
    assert.deepEqual(Object.keys(body).sort(), [...ALLOWED].sort());
    const { status, body: res } = await put(body);
    assert.equal(status, 200);
    assert.equal(res.success, true);
    assert.equal(res.message, 'Profile updated successfully');
    assert.ok(res.data.user);
    const set = assertSafeUpdate(onlyUpdate());
    assert.deepEqual(set, { ...body, profileCompleted: true });
  });

  test('onboarding summary payload (components/onboarding/summary.jsx) saves every field', async () => {
    const body = {
      firstName: 'Alice',
      lastName: 'Smith',
      dateOfBirth: '1990-05-15',
      gender: 'female',
      height: 170,
      weight: 70,
      fitnessGoals: ['weight-loss'],
      location: 'Berlin',
      fitnessExperience: 'beginner',
      preferredWorkouts: 'Cardio,Strength',
      dietaryPreference: 'No Restrictions',
      workoutFrequency: '2-3',
      workoutDuration: '30-45',
      goalWeight: 62,
      targetMuscleGain: 3,
      currentStrengthLevel: 'Beginner',
    };
    const { status } = await put(body);
    assert.equal(status, 200);
    assert.deepEqual(assertSafeUpdate(onlyUpdate()), { ...body, profileCompleted: true });
  });

  test('profile page payload (modules/profile/components/profile.jsx) saves every field', async () => {
    const body = {
      firstName: 'Alice',
      lastName: 'Smith',
      gender: 'female',
      location: 'Berlin',
      dateOfBirth: '1990-05-15',
      height: 170,
      weight: 70,
      activityLevel: 'lightly-active',
      fitnessGoals: ['muscle-gain'],
      bio: 'About me',
      fitnessExperience: 'advanced',
      dietaryPreference: 'Keto',
      workoutFrequency: '4-5',
      workoutDuration: '60-90',
      preferredWorkouts: 'HIIT',
      goalWeight: 75,
      targetMuscleGain: 5,
      currentStrengthLevel: 'Advanced',
    };
    const { status } = await put(body);
    assert.equal(status, 200);
    assert.deepEqual(assertSafeUpdate(onlyUpdate()), { ...body, profileCompleted: true });
  });

  test('username already taken still returns 409 without writing', async () => {
    User.findOne.mock.mockImplementation(async () => ({ _id: 'other' }));
    const { status, body } = await put({ username: 'taken_name' });
    assert.equal(status, 409);
    assert.equal(body.message, 'Username is already taken');
    assert.equal(updates.length, 0);
  });
});

describe('PUT /user/profile: operator objects as field values', () => {
  for (const field of ['firstName', 'username', 'gender', 'height', 'dateOfBirth', 'fitnessGoals', 'bio', 'profilePhoto']) {
    test(`{"${field}": {"$gt": ""}} is rejected with 400 and nothing is written`, async () => {
      const { status, body } = await put({ [field]: { $gt: '' } });
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(updates.length, 0);
    });
  }

  test('Mongoose casting rejects an operator object even if it reaches the service (CastError)', async () => {
    // Bypass the validator and stub only the driver collection, so real Mongoose update casting runs.
    User.findByIdAndUpdate.mock.restore();
    let driverCalled = false;
    mock.method(User.collection, 'findOneAndUpdate', async () => { driverCalled = true; return null; });
    for (const field of ['firstName', 'location', 'height', 'gender', 'dateOfBirth']) {
      await assert.rejects(userService.updateProfile(user._id, { [field]: { $gt: '' } }), { name: 'CastError' });
    }
    assert.equal(driverCalled, false);
  });
});
