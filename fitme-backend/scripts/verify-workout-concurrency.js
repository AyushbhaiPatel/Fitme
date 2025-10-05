#!/usr/bin/env node
// Verifies idempotent, concurrency-safe workout completion against a REAL MongoDB, through the real
// service / recorder / dao code (no mocks except one injected failure).
//
//   node scripts/verify-workout-concurrency.js --uri "mongodb://localhost:27017/fitme_test"
//
// Safety: refuses to run without an explicit --uri (MONGODB_URI / .env are ignored) and unless the URI's
// database name ends with "_test" or "-test". It creates its own throwaway users (emails under
// @verify.invalid), touches only those users and their WorkoutSession documents, and deletes exactly
// those in a finally block. The URI is never printed. Exit code 0 = all invariants hold.

const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

const User = require('../src/api/user/user.model');
const WorkoutSession = require('../src/api/workout/workout-session.model');
const workoutDao = require('../src/api/workout/workout.dao');
const service = require('../src/api/workout/workout.service');
const { secondsToMinutes } = require('../src/api/workout/workout.duration');
const { nextCounters } = require('../src/api/workout/workout.counters');

const parseArgs = (argv) => {
  const args = { uri: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--uri') args.uri = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
};

// Database name of a mongodb:// or mongodb+srv:// URI ('' when none).
const databaseName = (uri) => {
  const m = /^mongodb(?:\+srv)?:\/\/[^/?]+\/([^?]*)/.exec(uri || '');
  return m ? decodeURIComponent(m[1]) : '';
};

const isTestDatabase = (name) => /^[^/\\. "$]+[_-]test$/.test(name);

const created = [];
const key = () => crypto.randomUUID();
const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
const log = (msg) => console.log(`  ok  ${msg}`);

const createUser = async (fields = {}) => {
  const _id = new mongoose.Types.ObjectId();
  created.push(_id);
  // Raw insert: no schema defaults, so a legacy shape (no totalWorkoutTimeSeconds) stays exactly as given.
  await User.collection.insertOne({
    _id,
    email: `verify-${_id}@verify.invalid`,
    password: '!not-a-login-password',
    firstName: 'Verify',
    lastName: 'Script',
    workoutHistory: [],
    ...fields,
  });
  return _id;
};

const raw = (userId) => User.collection.findOne({ _id: userId });
const sessionsOf = (userId) => WorkoutSession.collection.find({ user: userId }).toArray();

const assertTotals = async (userId, { workouts, seconds, calories }) => {
  const u = await raw(userId);
  assert.equal(u.totalWorkouts, workouts, 'totalWorkouts');
  assert.equal(u.totalWorkoutTimeSeconds, seconds, 'totalWorkoutTimeSeconds');
  assert.equal(u.totalCaloriesBurned, calories, 'totalCaloriesBurned');
  assert.equal(u.totalWorkoutTimeMinutes, secondsToMinutes(seconds), 'totalWorkoutTimeMinutes');
  assert.equal(u.averageWorkoutTimeMinutes, secondsToMinutes(Math.round(seconds / workouts)), 'averageWorkoutTimeMinutes');
  const sessions = await sessionsOf(userId);
  assert.equal(sessions.filter((s) => s.countersApplied === false).length, 0, 'no pending sessions');
  const page = (await service.getWorkoutHistory(userId, { limit: '100' })).data;
  assert.equal(page.pagination.total, workouts, 'history total equals totalWorkouts');
  const statsRes = (await service.getWorkoutStatistics(userId, { include: 'history' })).data.statistics;
  assert.equal(sum(statsRes.history, (h) => h.durationSeconds), seconds, 'history seconds equal total');
  assert.equal(sum(statsRes.history, (h) => h.caloriesBurned), calories, 'history calories equal total');
  return u;
};

const body = (extra = {}) => ({ durationSeconds: 35, caloriesBurned: 50, workoutName: 'Verify', ...extra });

const scenarios = {
  async distinctConcurrent() {
    const userId = await createUser();
    const bodies = Array.from({ length: 20 }, (_, i) => body({ durationSeconds: 30 + i, caloriesBurned: 10 + i, ...(i % 2 ? { clientSessionId: key() } : {}) }));
    const results = await Promise.all(bodies.map((b) => service.completeWorkout(userId, b)));
    assert.ok(results.every((r) => r.code === 200 && r.data.duplicate === false));
    assert.equal((await sessionsOf(userId)).length, 20);
    await assertTotals(userId, { workouts: 20, seconds: sum(bodies, (b) => b.durationSeconds), calories: sum(bodies, (b) => b.caloriesBurned) });
    log('20 concurrent distinct completions (keyed + keyless): all persisted, totals exact');
  },

  async identicalConcurrent() {
    const userId = await createUser();
    const k = key();
    const results = await Promise.all(Array.from({ length: 10 }, () => service.completeWorkout(userId, body({ clientSessionId: k }))));
    assert.ok(results.every((r) => r.code === 200));
    assert.equal(results.filter((r) => !r.data.duplicate).length, 1);
    for (const r of results) assert.deepEqual(r.data.statistics, results[0].data.statistics);
    assert.equal((await sessionsOf(userId)).length, 1);
    await assertTotals(userId, { workouts: 1, seconds: 35, calories: 50 });

    const again = await service.completeWorkout(userId, body({ clientSessionId: k }));
    assert.equal(again.data.duplicate, true);
    const conflict = await service.completeWorkout(userId, body({ clientSessionId: k, durationSeconds: 36 }));
    assert.equal(conflict.code, 409);
    assert.equal((await service.completeWorkout(userId, body({ clientSessionId: 'bad key' }))).code, 400);
    const keyless = await Promise.all([service.completeWorkout(userId, body()), service.completeWorkout(userId, body())]);
    assert.ok(keyless.every((r) => r.data.duplicate === false));
    await assertTotals(userId, { workouts: 3, seconds: 105, calories: 150 });
    log('10 identical keyed requests: 1 session, counted once, identical stats; repeat=duplicate, changed=409, bad key=400, keyless not deduped');
  },

  async legacyCarryOver() {
    const legacyEntry = { _id: new mongoose.Types.ObjectId(), durationMinutes: 1, caloriesBurned: 200, completedAt: new Date('2026-05-10T10:00:00Z'), workoutName: 'Old' };
    const userId = await createUser({ totalWorkouts: 1, totalCaloriesBurned: 200, totalWorkoutTimeMinutes: 1, averageWorkoutTimeMinutes: 1, workoutHistory: [legacyEntry] });
    const bodies = Array.from({ length: 10 }, (_, i) => body({ durationSeconds: 20 + i, caloriesBurned: 10, clientSessionId: key() }));
    const results = await Promise.all([...bodies.map((b) => service.completeWorkout(userId, b)), service.completeWorkout(userId, bodies[0])]);
    assert.ok(results.every((r) => r.code === 200));
    const u = await assertTotals(userId, { workouts: 11, seconds: 60 + sum(bodies, (b) => b.durationSeconds), calories: 300 });
    const first = u.workoutHistory.find((e) => String(e._id) === String(legacyEntry._id));
    assert.deepEqual(first, legacyEntry, 'legacy entry untouched');
    log('legacy minutes-only user: 60s carried over exactly once under 10 concurrent completions (+1 duplicate)');
  },

  async pipelineMatchesReference() {
    const userId = await createUser({ totalWorkouts: 1, totalCaloriesBurned: 7, totalWorkoutTimeMinutes: 0.58, averageWorkoutTimeMinutes: 0.58 });
    let before = await raw(userId);
    for (const seconds of [35, 59, 61, 1, 4500, 0]) {
      await service.completeWorkout(userId, body({ durationSeconds: seconds, caloriesBurned: 3, workoutName: '$totalWorkouts', completedExercises: [{ name: '$where', completed: true, caloriesBurned: 1 }] }));
      const after = await raw(userId);
      const expected = nextCounters(before, { durationSeconds: seconds, caloriesBurned: 3 });
      for (const [k, v] of Object.entries(expected)) assert.equal(after[k], v, `${k} after ${seconds}s`);
      before = after;
    }
    const last = (await raw(userId)).workoutHistory.at(-1);
    assert.equal(last.workoutName, '$totalWorkouts', '$-prefixed names stored literally');
    assert.equal(last.exercises[0].name, '$where');
    log('update pipeline arithmetic equals nextCounters (fractional legacy minutes, rounding, $-names literal)');
  },

  async trimUnderConcurrency() {
    const userId = await createUser();
    for (let i = 0; i < 45; i++) await service.completeWorkout(userId, body({ durationSeconds: 10, caloriesBurned: 1 }));
    const bodies = Array.from({ length: 20 }, (_, i) => body({ durationSeconds: 60 + i, caloriesBurned: 5, clientSessionId: key() }));
    const results = await Promise.all(bodies.map((b) => service.completeWorkout(userId, b)));
    assert.ok(results.every((r) => r.code === 200));
    const u = await assertTotals(userId, { workouts: 65, seconds: 450 + sum(bodies, (b) => b.durationSeconds), calories: 45 + 100 });
    assert.ok(u.workoutHistory.length >= 50, 'cache keeps at least the newest 50');
    assert.ok((u.workoutCacheTrimEpoch || 0) > 0, 'trims happened');
    const sessions = await sessionsOf(userId);
    assert.equal(sessions.length, 65);
    assert.ok(sessions.every((s) => s.countersApplied === true));
    log(`45 + 20 concurrent completions across cache trims: totals exact, cache ${u.workoutHistory.length}, epoch ${u.workoutCacheTrimEpoch}`);
  },

  async failureAfterClaimThenRetry() {
    const userId = await createUser();
    const k = key();
    const original = workoutDao.applyCompletionToUser;
    const consoleError = console.error;
    workoutDao.applyCompletionToUser = async () => { throw new Error('injected: database unavailable'); };
    console.error = () => {};
    try {
      await assert.rejects(service.completeWorkout(userId, body({ clientSessionId: k })), /injected/);
    } finally {
      workoutDao.applyCompletionToUser = original;
      console.error = consoleError;
    }
    const pending = await sessionsOf(userId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].countersApplied, false);
    assert.equal((await raw(userId)).totalWorkouts ?? 0, 0);

    const retries = await Promise.all([service.completeWorkout(userId, body({ clientSessionId: k })), service.completeWorkout(userId, body({ clientSessionId: k }))]);
    assert.ok(retries.every((r) => r.code === 200 && r.data.duplicate === true));
    await assertTotals(userId, { workouts: 1, seconds: 35, calories: 50 });
    log('failure after the claim: request errored, session pending; concurrent retries with the same key counted it exactly once');
  },
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.uri) throw new Error('Refusing to run: pass --uri explicitly (MONGODB_URI is ignored on purpose).');
  const dbName = databaseName(args.uri);
  if (!isTestDatabase(dbName)) throw new Error(`Refusing to run: database name must end with "_test" or "-test" (got "${dbName || '(none)'}").`);

  await mongoose.connect(args.uri, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  console.log(`Connected to database "${dbName}" (${hello.setName ? 'replica set' : 'standalone'}; transactions ${hello.setName ? 'available but not used' : 'unavailable'})`);
  await WorkoutSession.createIndexes();
  const indexes = await WorkoutSession.collection.indexes();
  const unique = indexes.find((i) => i.name === 'user_clientSessionId_unique');
  assert.ok(unique && unique.unique && unique.partialFilterExpression, 'unique partial { user, clientSessionId } index exists');

  let failed = false;
  try {
    for (const [name, run] of Object.entries(scenarios)) {
      try {
        await run();
      } catch (err) {
        failed = true;
        console.error(`  FAIL ${name}: ${err.message}`);
      }
    }
    // A second pass with different timing.
    for (const name of ['distinctConcurrent', 'identicalConcurrent', 'trimUnderConcurrency']) {
      try {
        await scenarios[name]();
      } catch (err) {
        failed = true;
        console.error(`  FAIL ${name} (pass 2): ${err.message}`);
      }
    }
  } finally {
    const sessions = await WorkoutSession.collection.deleteMany({ user: { $in: created } });
    const users = await User.collection.deleteMany({ _id: { $in: created } });
    console.log(`Cleanup: removed ${users.deletedCount} of ${created.length} throwaway users and ${sessions.deletedCount} of their sessions.`);
    await mongoose.disconnect();
  }
  if (failed) {
    console.error('Workout concurrency verification FAILED');
    process.exitCode = 1;
  } else {
    console.log('Workout concurrency verification passed');
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, databaseName, isTestDatabase };
