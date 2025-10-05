const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');

const workoutDao = require('./workout.dao');
const service = require('./workout.service');
const controller = require('./workout.controller');
const recorder = require('./workout.recorder');
const WorkoutSession = require('./workout-session.model');
const User = require('../user/user.model');
const { installSessionStore } = require('./workout.testkit');
const { buildApplyUpdate, nextCounters } = require('./workout.counters');
const { entrySeconds, secondsToMinutes } = require('./workout.duration');

// Idempotent, concurrency-safe completions (workout.recorder.js). The dao is the in-memory fake
// (workout.testkit.js): every operation yields between its atomic steps, so Promise.all interleaves.

const KEY = '3f1b2c4d-aaaa-4bbb-8ccc-123456789abc';
const KEY2 = '9e8d7c6b-1111-4222-8333-abcdefabcdef';
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

const makeUser = (overrides = {}) => ({
  totalWorkouts: 0,
  totalCaloriesBurned: 0,
  totalWorkoutTimeMinutes: 0,
  averageWorkoutTimeMinutes: 0,
  workoutHistory: [],
  ...overrides,
});

const useUser = (user, storeOptions = {}) => {
  mock.method(workoutDao, 'findUserById', async () => user);
  const sessionStore = installSessionStore(storeOptions);
  return { user, sessionStore };
};

const body = (extra = {}) => ({ durationSeconds: 35, caloriesBurned: 50, workoutName: 'Day 1', ...extra });
const complete = (b, opts) => service.completeWorkout('u1', b, opts);
const stats = async () => (await service.getWorkoutStatistics('u1', { include: 'history' })).data.statistics;
const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
const oid = () => new Types.ObjectId();
const quiet = () => mock.method(console, 'error', () => {});

// Totals, history and the session store all agree, and nothing is left pending.
const assertConsistent = async (user, sessionStore, { workouts, seconds, calories }) => {
  assert.equal(user.totalWorkouts, workouts);
  assert.equal(user.totalWorkoutTimeSeconds, seconds);
  assert.equal(user.totalCaloriesBurned, calories);
  assert.equal(user.totalWorkoutTimeMinutes, secondsToMinutes(seconds));
  assert.equal(user.averageWorkoutTimeMinutes, secondsToMinutes(Math.round(seconds / workouts)));
  assert.equal(sessionStore.store.filter((d) => d.countersApplied === false).length, 0, 'no pending sessions');
  const s = await stats();
  assert.equal(s.totalWorkouts, workouts);
  assert.equal(s.history.length, workouts);
  assert.equal(sum(s.history, (h) => h.durationSeconds), seconds);
  assert.equal(sum(s.history, (h) => h.caloriesBurned), calories);
  assert.equal(new Set(s.history.map((h) => String(h._id))).size, workouts);
};

afterEach(() => mock.restoreAll());

describe('keyed completion', () => {
  test('one normal completion: recorded, counted, marked, key stored', async () => {
    const { user, sessionStore } = useUser(makeUser());
    const res = await complete(body({ clientSessionId: KEY }));
    assert.equal(res.code, 200);
    assert.equal(res.message, 'Workout completed successfully');
    assert.equal(res.data.duplicate, false);
    assert.equal(res.data.clientSessionId, KEY);
    assert.deepEqual(res.data.statistics, {
      totalWorkouts: 1, totalCaloriesBurned: 50, totalWorkoutTimeSeconds: 35, averageWorkoutTimeSeconds: 35, totalWorkoutTimeMinutes: 0.58, averageWorkoutTimeMinutes: 0.58,
    });
    assert.equal(res.data.workout.durationSeconds, 35);
    assert.equal(res.data.workout.caloriesBurned, 50);
    assert.equal(res.data.workout.workoutName, 'Day 1');
    assert.equal(res.data.workout.sessionId, String(sessionStore.store[0]._id));
    assert.equal(sessionStore.store.length, 1);
    assert.equal(sessionStore.store[0].clientSessionId, KEY);
    assert.equal(sessionStore.store[0].countersApplied, true);
    assert.equal(String(user.workoutHistory[0]._id), res.data.workout.sessionId);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('repeat after success returns the original result and counts nothing again', async () => {
    const { user, sessionStore } = useUser(makeUser());
    const first = await complete(body({ clientSessionId: KEY }));
    const snapshot = JSON.stringify(user);
    for (let i = 0; i < 3; i++) {
      const again = await complete(body({ clientSessionId: KEY }));
      assert.equal(again.code, 200);
      assert.equal(again.message, 'Workout already recorded');
      assert.equal(again.data.duplicate, true);
      assert.deepEqual(again.data.statistics, first.data.statistics);
      assert.deepEqual(again.data.workout, first.data.workout); // same session id and completedAt
    }
    assert.equal(JSON.stringify(user), snapshot);
    assert.equal(sessionStore.applyUser.mock.callCount(), 1);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('keys are scoped per user', async () => {
    const users = { a: makeUser(), b: makeUser() };
    mock.method(workoutDao, 'findUserById', async (id) => users[id]);
    const sessionStore = installSessionStore();
    assert.equal((await service.completeWorkout('a', body({ clientSessionId: KEY }))).data.duplicate, false);
    assert.equal((await service.completeWorkout('b', body({ clientSessionId: KEY }))).data.duplicate, false);
    assert.equal(sessionStore.store.length, 2);
    assert.equal(users.a.totalWorkouts, 1);
    assert.equal(users.b.totalWorkouts, 1);
  });
});

describe('concurrent requests', () => {
  for (const seed of SEEDS) {
    test(`two identical simultaneous requests: one session, counted once, identical 200 responses (seed ${seed})`, async () => {
      const { user, sessionStore } = useUser(makeUser(), { seed });
      const [a, b] = await Promise.all([complete(body({ clientSessionId: KEY })), complete(body({ clientSessionId: KEY }))]);
      assert.equal(a.code, 200);
      assert.equal(b.code, 200);
      assert.deepEqual([a.data.duplicate, b.data.duplicate].sort(), [false, true]);
      assert.deepEqual(a.data.statistics, b.data.statistics);
      assert.deepEqual(a.data.workout, b.data.workout);
      assert.equal(a.data.statistics.totalWorkouts, 1);
      assert.equal(sessionStore.store.length, 1);
      assert.equal(user.workoutHistory.length, 1);
      await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
    });
  }

  test('five identical simultaneous requests count once', async () => {
    const { user, sessionStore } = useUser(makeUser(), { seed: 7 });
    const results = await Promise.all(Array.from({ length: 5 }, () => complete(body({ clientSessionId: KEY }))));
    assert.ok(results.every((r) => r.code === 200));
    assert.equal(results.filter((r) => !r.data.duplicate).length, 1);
    assert.ok(results.every((r) => r.data.statistics.totalWorkouts === 1));
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  for (const seed of SEEDS) {
    test(`two distinct simultaneous completions both persist with exact totals (seed ${seed})`, async () => {
      const { user, sessionStore } = useUser(makeUser(), { seed });
      const [a, b] = await Promise.all([
        complete(body({ clientSessionId: KEY, durationSeconds: 35, caloriesBurned: 50 })),
        complete(body({ clientSessionId: KEY2, durationSeconds: 90, caloriesBurned: 120 })),
      ]);
      assert.equal(a.code, 200);
      assert.equal(b.code, 200);
      assert.equal(a.data.duplicate || b.data.duplicate, false);
      assert.equal(sessionStore.store.length, 2);
      await assertConsistent(user, sessionStore, { workouts: 2, seconds: 125, calories: 170 });
    });
  }

  for (const seed of [1, 2, 3, 4, 5]) {
    test(`20 concurrent distinct completions (keyed and keyless) are all counted exactly (seed ${seed})`, async () => {
      const { user, sessionStore } = useUser(makeUser(), { seed });
      const bodies = Array.from({ length: 20 }, (_, i) => body({ durationSeconds: 30 + i, caloriesBurned: 10 + i, ...(i % 2 ? { clientSessionId: `key-${seed}-${String(i).padStart(4, '0')}` } : {}) }));
      const results = await Promise.all(bodies.map((b) => complete(b)));
      assert.ok(results.every((r) => r.code === 200 && r.data.duplicate === false));
      assert.equal(sessionStore.store.length, 20);
      assert.equal(user.workoutHistory.length, 20);
      await assertConsistent(user, sessionStore, { workouts: 20, seconds: sum(bodies, (b) => b.durationSeconds), calories: sum(bodies, (b) => b.caloriesBurned) });
    });
  }

  for (const seed of [1, 2, 3]) {
    test(`20 concurrent completions while the cache is being trimmed: exact totals, nothing lost (seed ${seed})`, async () => {
      // 45 migrated entries: the cache crosses 50 during the burst, so trims (epoch changes) race the applies.
      const embedded = Array.from({ length: 45 }, (_, i) => ({ _id: oid(), durationSeconds: 10, durationMinutes: 0.17, caloriesBurned: 1, completedAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000) }));
      const sessions = embedded.map((e) => ({ ...e, user: 'u1', source: 'migration' }));
      const { user, sessionStore } = useUser(makeUser({ totalWorkouts: 45, totalCaloriesBurned: 45, totalWorkoutTimeSeconds: 450, workoutHistory: embedded }), { sessions, seed });
      const bodies = Array.from({ length: 20 }, (_, i) => body({ durationSeconds: 60 + i, caloriesBurned: 5, clientSessionId: `burst-${seed}-${String(i).padStart(3, '0')}` }));
      const results = await Promise.all(bodies.map((b) => complete(b)));
      assert.ok(results.every((r) => r.code === 200));
      assert.ok(user.workoutCacheTrimEpoch > 0, 'trims happened during the burst');
      assert.ok(user.workoutHistory.length >= 50);
      await assertConsistent(user, sessionStore, { workouts: 65, seconds: 450 + sum(bodies, (b) => b.durationSeconds), calories: 45 + 100 });
      // Every new session is either still cached or was trimmed only after being marked counted.
      const cached = new Set(Array.from(user.workoutHistory).map((e) => String(e._id)));
      for (const d of sessionStore.store.filter((x) => x.source === 'completion')) assert.ok(cached.has(String(d._id)) || d.countersApplied === true);
    });
  }

  test('same key, different payloads at the same time: exactly one wins, the other gets 409', async () => {
    for (const seed of SEEDS) {
      mock.restoreAll();
      const { user, sessionStore } = useUser(makeUser(), { seed });
      const results = await Promise.all([complete(body({ clientSessionId: KEY })), complete(body({ clientSessionId: KEY, durationSeconds: 99 }))]);
      assert.deepEqual(results.map((r) => r.code).sort(), [200, 409]);
      assert.equal(sessionStore.store.length, 1);
      assert.equal(user.totalWorkouts, 1);
    }
  });
});

describe('same key, different payload -> 409', () => {
  const variants = [
    ['durationSeconds', { durationSeconds: 36 }],
    ['rounded calories', { caloriesBurned: 51 }],
    ['workoutName', { workoutName: 'Day 2' }],
    ['workoutId', { workoutId: '6af86ada4bfdc6f87f055077' }],
    ['exercises', { completedExercises: [{ name: 'Squat', completed: true, caloriesBurned: 10 }] }],
    ['exercise set counts', { completedExercises: [{ name: 'Squat', completed: false, caloriesBurned: 10, completedSets: 2, totalSets: 4 }] }],
  ];
  for (const [label, change] of variants) {
    test(`${label} differs -> 409, nothing changed`, async () => {
      const { user, sessionStore } = useUser(makeUser());
      const base = body({ clientSessionId: KEY, completedExercises: [{ name: 'Squat', completed: false, caloriesBurned: 10, completedSets: 1, totalSets: 4 }] });
      await complete(base);
      const before = JSON.stringify(user);
      const res = await complete({ ...base, ...change });
      assert.equal(res.code, 409);
      assert.equal(res.success, false);
      assert.equal(res.message, 'This clientSessionId was already used for a different workout');
      assert.equal(JSON.stringify(user), before);
      assert.equal(sessionStore.store.length, 1);
    });
  }

  test('differences that normalise away are the same workout (duplicate, not 409)', async () => {
    useUser(makeUser());
    await complete(body({ clientSessionId: KEY, caloriesBurned: 50, workoutName: 'Day 1' }));
    for (const same of [{ caloriesBurned: 49.6 }, { caloriesBurned: '50' }, { workoutName: '  Day 1 ' }, { durationSeconds: 35.2 }, { durationSeconds: undefined, durationMinutes: 35 / 60 }]) {
      const res = await complete(body({ clientSessionId: KEY, ...same }));
      assert.equal(res.code, 200, JSON.stringify(same));
      assert.equal(res.data.duplicate, true);
    }
  });
});

describe('requests without a key (old clients)', () => {
  test('identical keyless requests are never deduplicated, sequential or simultaneous', async () => {
    const { user, sessionStore } = useUser(makeUser());
    await complete(body());
    await complete(body());
    const both = await Promise.all([complete(body()), complete(body())]);
    assert.ok(both.every((r) => r.code === 200 && r.data.duplicate === false && r.data.clientSessionId === null));
    assert.equal(sessionStore.store.length, 4);
    assert.ok(sessionStore.store.every((d) => !('clientSessionId' in d)));
    await assertConsistent(user, sessionStore, { workouts: 4, seconds: 140, calories: 200 });
  });
});

describe('partial and full completions', () => {
  const partial = { durationSeconds: 47, caloriesBurned: 35, completedExercises: [{ name: 'Bench', completed: false, caloriesBurned: 35, completedSets: 2, totalSets: 4 }] };
  const full = { durationSeconds: 600, caloriesBurned: 150, completedExercises: [{ name: 'Bench', completed: true, caloriesBurned: 150, completedSets: 4, totalSets: 4 }] };

  test('a partial save and its retry count once; a later full session with its own key counts too', async () => {
    const { user, sessionStore } = useUser(makeUser());
    const [p1, p2] = await Promise.all([complete({ ...partial, clientSessionId: KEY }), complete({ ...partial, clientSessionId: KEY })]);
    assert.deepEqual([p1.data.duplicate, p2.data.duplicate].sort(), [false, true]);
    assert.equal((await complete({ ...full, clientSessionId: KEY2 })).data.duplicate, false);
    assert.equal((await complete({ ...full, clientSessionId: KEY2 })).data.duplicate, true);
    assert.deepEqual(user.workoutHistory.map((e) => e.exercises[0].completedSets), [2, 4]);
    await assertConsistent(user, sessionStore, { workouts: 2, seconds: 647, calories: 185 });
  });

  test('turning a recorded partial save into a full one under the same key is a conflict', async () => {
    useUser(makeUser());
    await complete({ ...partial, clientSessionId: KEY });
    assert.equal((await complete({ ...full, clientSessionId: KEY })).code, 409);
  });
});

describe('failures and recovery', () => {
  test('failure after the claim (counter update keeps failing) -> error; retry with the same key counts exactly once', async () => {
    quiet();
    const { user, sessionStore } = useUser(makeUser());
    sessionStore.fail('applyCompletionToUser', { times: recorder.APPLY_ATTEMPTS, error: new Error('db down') });
    await assert.rejects(complete(body({ clientSessionId: KEY })), /db down/);
    assert.equal(sessionStore.store.length, 1);
    assert.equal(sessionStore.store[0].countersApplied, false);
    assert.equal(user.totalWorkouts, 0);
    assert.equal(user.workoutHistory.length, 0);

    const retry = await complete(body({ clientSessionId: KEY }));
    assert.equal(retry.code, 200);
    assert.equal(retry.data.duplicate, true);
    assert.equal(retry.data.statistics.totalWorkouts, 1);
    assert.equal((await complete(body({ clientSessionId: KEY }))).data.statistics.totalWorkouts, 1);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('retry arriving while the failed request is still retrying converges to one count', async () => {
    quiet();
    for (const seed of SEEDS) {
      mock.restoreAll();
      quiet();
      const { user, sessionStore } = useUser(makeUser(), { seed });
      sessionStore.fail('applyCompletionToUser', { times: 2, error: new Error('transient') });
      const results = await Promise.all([complete(body({ clientSessionId: KEY })), complete(body({ clientSessionId: KEY }))]);
      assert.ok(results.every((r) => r.code === 200));
      assert.equal(user.totalWorkouts, 1, `seed ${seed}`);
      assert.equal(sessionStore.store.length, 1);
    }
  });

  test('counter update applied but its acknowledgement lost -> no second application', async () => {
    const { user, sessionStore } = useUser(makeUser());
    sessionStore.fail('applyCompletionToUser', { after: true, error: new Error('socket closed') });
    const res = await complete(body({ clientSessionId: KEY }));
    assert.equal(res.code, 200);
    assert.equal(res.data.statistics.totalWorkouts, 1);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('crash between counter update and marking: success, and the next request marks it without re-counting', async () => {
    quiet();
    const { user, sessionStore } = useUser(makeUser());
    sessionStore.fail('markCountersApplied', { times: 1 });
    assert.equal((await complete(body({ clientSessionId: KEY }))).code, 200);
    assert.equal(sessionStore.store[0].countersApplied, false); // counted and cached, not marked yet
    assert.equal(user.totalWorkouts, 1);
    const retry = await complete(body({ clientSessionId: KEY }));
    assert.equal(retry.data.duplicate, true);
    assert.equal(sessionStore.store[0].countersApplied, true);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('pending session with no retry is applied once by the next completion', async () => {
    quiet();
    const { user, sessionStore } = useUser(makeUser());
    sessionStore.fail('applyCompletionToUser', { times: recorder.APPLY_ATTEMPTS });
    await assert.rejects(complete(body({ clientSessionId: KEY })));
    const next = await complete(body({ durationSeconds: 100, caloriesBurned: 1 })); // keyless
    assert.equal(next.data.statistics.totalWorkouts, 2);
    await assertConsistent(user, sessionStore, { workouts: 2, seconds: 135, calories: 51 });
  });

  test('pending session is applied once by the next statistics read; reads with nothing pending write nothing', async () => {
    quiet();
    const { user, sessionStore } = useUser(makeUser());
    sessionStore.fail('applyCompletionToUser', { times: recorder.APPLY_ATTEMPTS });
    await assert.rejects(complete(body()));
    const s = await stats();
    assert.equal(s.totalWorkouts, 1);
    assert.equal(s.history.length, 1);
    const writes = sessionStore.applyUser.mock.callCount() + sessionStore.mark.mock.callCount();
    await stats();
    await service.getWorkoutHistory('u1', {});
    await service.getWeeklySummary('u1');
    assert.equal(sessionStore.applyUser.mock.callCount() + sessionStore.mark.mock.callCount(), writes);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('failure before the claim -> nothing recorded; retry with the same key succeeds normally', async () => {
    const user = makeUser();
    let calls = 0;
    mock.method(workoutDao, 'findUserById', async () => { calls += 1; if (calls === 1) throw new Error('db down'); return user; });
    const sessionStore = installSessionStore();
    await assert.rejects(complete(body({ clientSessionId: KEY })), /db down/);
    assert.equal(sessionStore.store.length, 0);
    assert.equal(sessionStore.create.mock.callCount(), 0);
    const res = await complete(body({ clientSessionId: KEY }));
    assert.equal(res.code, 200);
    assert.equal(res.data.duplicate, false);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('claim keeps failing -> error, nothing stored; a retry with the same key records it once', async () => {
    const { user, sessionStore } = useUser(makeUser());
    sessionStore.fail('createSession', { times: 3 });
    await assert.rejects(complete(body({ clientSessionId: KEY })));
    assert.equal(sessionStore.store.length, 0);
    assert.equal(user.totalWorkouts, 0);
    assert.equal((await complete(body({ clientSessionId: KEY }))).data.duplicate, false);
    await assertConsistent(user, sessionStore, { workouts: 1, seconds: 35, calories: 50 });
  });

  test('account deleted mid-request -> 404 and the pending claim is removed', async () => {
    const user = makeUser();
    let calls = 0;
    mock.method(workoutDao, 'findUserById', async () => { calls += 1; return calls === 1 ? user : null; });
    const sessionStore = installSessionStore();
    const res = await complete(body({ clientSessionId: KEY }));
    assert.equal(res.code, 404);
    assert.equal(sessionStore.store.length, 0);
    assert.equal(user.totalWorkouts, 0);
  });

  test('a stale actor cannot re-apply a session that was counted, marked and trimmed meanwhile (epoch fence)', async () => {
    const { user, sessionStore } = useUser(makeUser());
    // Actor A reads the user (epoch) and sees session S pending, then stalls.
    sessionStore.fail('applyCompletionToUser', { times: recorder.APPLY_ATTEMPTS });
    quiet();
    await assert.rejects(complete(body({ clientSessionId: KEY })));
    const staleKnown = { user, epoch: user.workoutCacheTrimEpoch || 0 };
    const staleState = { ...sessionStore.store[0] };
    assert.equal(staleState.countersApplied, false);

    // Meanwhile S is applied and marked by a retry, and 55 newer sessions push it out of the cache.
    assert.equal((await complete(body({ clientSessionId: KEY }))).data.duplicate, true);
    for (let i = 0; i < 55; i++) await complete(body({ durationSeconds: 1, caloriesBurned: 0 }));
    assert.equal(user.workoutHistory.some((e) => String(e._id) === String(staleState._id)), false, 'S trimmed');
    assert.ok(user.workoutCacheTrimEpoch > staleKnown.epoch);

    // A resumes with its stale view: its conditional update does not match, it re-reads and sees S marked.
    const appliesBefore = sessionStore.applyUser.mock.callCount();
    await recorder.ensureApplied('u1', staleState, staleKnown);
    assert.equal(sessionStore.applyUser.mock.callCount(), appliesBefore + 1);
    assert.equal(user.totalWorkouts, 56);
    assert.equal(user.totalWorkoutTimeSeconds, 35 + 55);
  });
});

describe('legacy minutes-only user', () => {
  const legacyDoc = () => ({
    _id: '6af86564a4a4013c286ff4be',
    email: 'legacy@example.com',
    firstName: 'L',
    lastName: 'U',
    totalWorkouts: 1,
    totalCaloriesBurned: 200,
    totalWorkoutTimeMinutes: 1,
    averageWorkoutTimeMinutes: 1,
    workoutHistory: [{ _id: '6af86ada4bfdc6f87f055077', durationMinutes: 1, caloriesBurned: 200, completedAt: new Date('2026-05-10T10:00:00Z'), workoutName: 'Old' }],
  });

  for (const [label, build] of [['plain object', () => makeUser(legacyDoc())], ['hydrated document', () => User.hydrate(legacyDoc())]]) {
    for (const seed of [1, 2, 3, 4]) {
      test(`${label}: legacy minutes carried over exactly once under 10 concurrent completions (seed ${seed})`, async () => {
        const user = build();
        const { sessionStore } = useUser(user, { seed });
        const bodies = Array.from({ length: 10 }, (_, i) => body({ durationSeconds: 20 + i, caloriesBurned: 10, ...(i % 3 ? { clientSessionId: `legacy-${seed}-${i}-xxxx` } : {}) }));
        const results = await Promise.all([...bodies.map((b) => complete(b)), complete(bodies[1])]); // plus one duplicate
        assert.ok(results.every((r) => r.code === 200));
        const seconds = 60 + sum(bodies, (b) => b.durationSeconds);
        assert.equal(user.totalWorkoutTimeSeconds, seconds);
        assert.equal(user.totalWorkouts, 11);
        assert.equal(user.totalCaloriesBurned, 300);
        assert.equal(user.totalWorkoutTimeMinutes, secondsToMinutes(seconds));
        assert.equal(user.averageWorkoutTimeMinutes, secondsToMinutes(Math.round(seconds / 11)));
        assert.equal(user.workoutHistory[0].durationMinutes, 1);
        assert.equal(user.workoutHistory[0].durationSeconds, undefined); // legacy entry never rewritten
        assert.equal(sessionStore.store.length, 10);
        const s = await stats();
        assert.equal(s.totalWorkoutTimeSeconds, seconds);
        assert.equal(sum(s.history, (h) => h.durationSeconds), seconds);
      });
    }
  }
});

describe('key validation and transport', () => {
  for (const bad of ['short', 'x'.repeat(65), 'has space', 'a/b/c/d/e', 'ключ-ключ-ключ', '', 12345678, {}, ['abcdefgh'], true]) {
    test(`malformed clientSessionId ${JSON.stringify(bad)} -> 400, nothing written`, async () => {
      const { user, sessionStore } = useUser(makeUser());
      const res = await complete(body({ clientSessionId: bad }));
      assert.equal(res.code, 400);
      assert.equal(res.message, recorder.MESSAGES.invalidBodyKey);
      assert.equal(sessionStore.create.mock.callCount(), 0);
      assert.equal(user.totalWorkouts, 0);
    });
  }

  test('boundary lengths 8 and 64 are accepted; null means no key', async () => {
    const { sessionStore } = useUser(makeUser());
    assert.equal((await complete(body({ clientSessionId: 'a'.repeat(8) }))).code, 200);
    assert.equal((await complete(body({ clientSessionId: 'B_-9'.repeat(16) }))).code, 200);
    assert.equal((await complete(body({ clientSessionId: null }))).data.clientSessionId, null);
    assert.equal(sessionStore.store.length, 3);
  });

  test('Idempotency-Key header works like the body field and dedupes against it', async () => {
    const { user, sessionStore } = useUser(makeUser());
    const viaHeader = await complete(body(), { idempotencyKey: KEY });
    assert.equal(viaHeader.data.duplicate, false);
    assert.equal(sessionStore.store[0].clientSessionId, KEY);
    assert.equal((await complete(body({ clientSessionId: KEY }))).data.duplicate, true);
    assert.equal((await complete(body({ clientSessionId: KEY }), { idempotencyKey: KEY })).data.duplicate, true);
    assert.equal(user.totalWorkouts, 1);
  });

  test('malformed header -> 400; body and header both present but different -> 400', async () => {
    const { sessionStore } = useUser(makeUser());
    const badHeader = await complete(body(), { idempotencyKey: 'bad key' });
    assert.equal(badHeader.code, 400);
    assert.equal(badHeader.message, recorder.MESSAGES.invalidHeaderKey);
    const mismatch = await complete(body({ clientSessionId: KEY }), { idempotencyKey: KEY2 });
    assert.equal(mismatch.code, 400);
    assert.equal(mismatch.message, recorder.MESSAGES.keyMismatch);
    assert.equal(sessionStore.create.mock.callCount(), 0);
  });

  test('controller passes the Idempotency-Key header through', async () => {
    const { user } = useUser(makeUser());
    const call = async () => {
      const res = { statusCode: null, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
      const req = { user: { _id: 'u1' }, body: body(), get: (h) => (h.toLowerCase() === 'idempotency-key' ? KEY : undefined) };
      await controller.completeWorkout(req, res, (err) => { throw err; });
      return res;
    };
    const first = await call();
    const second = await call();
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.data.duplicate, false);
    assert.equal(second.payload.data.duplicate, true);
    assert.equal(user.totalWorkouts, 1);
  });
});

describe('schema, migration and pipeline', () => {
  test('WorkoutSession has the partial unique key index and the pending index', () => {
    const indexes = WorkoutSession.schema.indexes();
    const unique = indexes.find(([k]) => Object.keys(k).join(',') === 'user,clientSessionId');
    assert.ok(unique);
    assert.equal(unique[1].unique, true);
    assert.deepEqual(unique[1].partialFilterExpression, { clientSessionId: { $type: 'string' } });
    const pending = indexes.find(([, o]) => o.name === 'user_countersPending');
    assert.deepEqual(pending[1].partialFilterExpression, { countersApplied: false });
    const fresh = new WorkoutSession({ _id: oid(), user: oid(), completedAt: new Date(), durationSeconds: 1, source: 'completion' });
    assert.equal(fresh.countersApplied, undefined); // no default: absent means counted
    assert.equal(fresh.clientSessionId, undefined);
  });

  test('migrated copies carry no key and count as already applied', async () => {
    const { migrateUserHistory, buildMigrationDoc } = require('./workout.migration');
    const embedded = [
      { _id: oid(), durationMinutes: 1, caloriesBurned: 200, completedAt: new Date('2026-05-10T10:00:00Z') },
      { _id: oid(), durationSeconds: 30, caloriesBurned: 5, completedAt: new Date('2026-05-11T10:00:00Z') },
    ];
    const doc = buildMigrationDoc('u1', embedded[0], new Date());
    assert.equal('clientSessionId' in doc, false);
    assert.equal('countersApplied' in doc, false);

    const { user, sessionStore } = useUser(makeUser({ totalWorkouts: 2, totalCaloriesBurned: 205, totalWorkoutTimeMinutes: 1.5, workoutHistory: embedded }));
    const report = await migrateUserHistory({ _id: 'u1', workoutHistory: embedded }, { apply: true });
    assert.equal(report.copied, 2); // two keyless docs: no unique-index collision
    assert.equal((await complete(body({ clientSessionId: KEY }))).code, 200);
    assert.equal(user.totalWorkouts, 3); // migrated copies were not re-applied by reconciliation
    assert.equal(user.totalWorkoutTimeSeconds, 90 + 35);
    assert.equal(sessionStore.store.length, 3);
  });

  test('update pipeline: conditional filter, $literal entry, counters match nextCounters', () => {
    const entry = { _id: oid(), workoutId: null, completedAt: new Date(), caloriesBurned: 7, durationSeconds: 35, durationMinutes: 0.58, workoutName: '$totalWorkouts', exercises: [{ name: '$where', completed: true, caloriesBurned: 1 }] };
    const { filter, pipeline } = buildApplyUpdate('u1', entry, 3);
    assert.deepEqual(filter['workoutHistory._id'], { $ne: entry._id });
    assert.deepEqual(filter.$expr, { $eq: [{ $ifNull: ['$workoutCacheTrimEpoch', 0] }, 3] });
    assert.deepEqual(pipeline[0].$set.workoutHistory.$concatArrays[1], [{ $literal: entry }]);
    assert.deepEqual(nextCounters({ totalWorkouts: 1, totalCaloriesBurned: 200, totalWorkoutTimeMinutes: 1 }, entry), {
      totalWorkouts: 2, totalCaloriesBurned: 207, totalWorkoutTimeSeconds: 95, totalWorkoutTimeMinutes: 1.58, averageWorkoutTimeMinutes: 0.8,
    });
    assert.equal(entrySeconds(recorder.cacheEntryFromSession({ ...entry, durationSeconds: 35 })), 35);
  });
});
