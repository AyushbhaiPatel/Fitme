const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');

const workoutDao = require('./workout.dao');
const service = require('./workout.service');
const history = require('./workout.history');
const User = require('../user/user.model');
const WorkoutSession = require('./workout-session.model');
const { installSessionStore } = require('./workout.testkit');
const { entrySeconds } = require('./workout.duration');

// Complete history across the WorkoutSession collection and the embedded cache.
// The dao is mocked (in-memory session store); nothing touches the database.

const makeUser = (overrides = {}) => ({
  totalWorkouts: 0,
  totalCaloriesBurned: 0,
  totalWorkoutTimeMinutes: 0,
  averageWorkoutTimeMinutes: 0,
  workoutHistory: [],
  ...overrides,
});

// `save` is the atomic counter update (the only write to the user document on completion).
const useUser = (user, storeOptions = {}) => {
  mock.method(workoutDao, 'findUserById', async () => user);
  const sessionStore = installSessionStore(storeOptions);
  return { user, save: sessionStore.applyUser, sessionStore };
};

// Completes a workout with the clock set to `at`.
const completeAt = async (at, body) => {
  mock.timers.enable({ apis: ['Date'], now: new Date(at) });
  try {
    return await service.completeWorkout('u1', body);
  } finally {
    mock.timers.reset();
  }
};

const statsWith = async (query) => (await service.getWorkoutStatistics('u1', query)).data.statistics;
const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
const oid = () => new Types.ObjectId();
const session = (completedAt, extra = {}) => ({ _id: oid(), user: 'u1', completedAt: new Date(completedAt), durationSeconds: 60, caloriesBurned: 10, workoutName: 'S', exercises: [], source: 'completion', ...extra });

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe('more than 50 sessions: history is complete', () => {
  // 120 sessions across 2026, every ~2.6 days, with varying durations and calories.
  const times = Array.from({ length: 120 }, (_, i) => Date.UTC(2026, 0, 1, 9) + Math.floor(i * 2.6 * 86400000));
  const bodyFor = (i) => ({ durationSeconds: 30 + i * 7, caloriesBurned: 100 + i });

  const completeAll = async () => {
    const ctx = useUser(makeUser());
    for (let i = 0; i < times.length; i++) assert.equal((await completeAt(times[i], bodyFor(i))).code, 200);
    return ctx;
  };

  test('year history returns all 120 sessions and matches lifetime totals', async () => {
    const { user, sessionStore } = await completeAll();
    assert.equal(user.workoutHistory.length, 50); // embedded cache stays bounded
    assert.equal(sessionStore.store.length, 120);

    const s = await statsWith({ include: 'history', from: '2026-01-01T00:00:00Z' });
    assert.equal(s.history.length, 120);
    assert.equal(s.history.length, s.totalWorkouts);
    assert.equal(sum(s.history, (h) => h.caloriesBurned), s.totalCaloriesBurned);
    assert.equal(sum(s.history, (h) => h.durationSeconds), s.totalWorkoutTimeSeconds);
    assert.deepEqual(s.history.map((h) => new Date(h.completedAt).getTime()), times); // oldest first
    assert.equal(new Set(s.history.map((h) => String(h._id))).size, 120);
    assert.deepEqual(s.historyInfo, { from: new Date('2026-01-01T00:00:00Z'), to: null, limit: 1000, returned: 120, total: 120, truncated: false });

    // Default include=history (no range) is also complete for this user.
    assert.equal((await statsWith({ include: 'history' })).history.length, 120);
  });

  test('quarter range returns exactly the sessions in that quarter', async () => {
    await completeAll();
    const from = Date.UTC(2026, 6, 1);
    const to = Date.UTC(2026, 9, 1);
    const expected = times.filter((t) => t >= from && t < to);
    assert.ok(expected.length > 30);

    const s = await statsWith({ include: 'history', from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    assert.deepEqual(s.history.map((h) => new Date(h.completedAt).getTime()), expected);
    const idx = times.map((t, i) => [t, i]).filter(([t]) => t >= from && t < to).map(([, i]) => i);
    assert.equal(sum(s.history, (h) => h.caloriesBurned), sum(idx, (i) => bodyFor(i).caloriesBurned));
    assert.equal(sum(s.history, (h) => h.durationSeconds), sum(idx, (i) => bodyFor(i).durationSeconds));
    // Lifetime totals are unaffected by the range.
    assert.equal(s.totalWorkouts, 120);
  });

  test('history entries keep the response shape analytics reads', async () => {
    await completeAll();
    const [first] = (await statsWith({ include: 'history' })).history;
    for (const key of ['_id', 'workoutId', 'completedAt', 'caloriesBurned', 'durationSeconds', 'durationMinutes', 'workoutName', 'exercises']) assert.ok(key in first, key);
    assert.equal(first.durationSeconds, 30);
    assert.equal(first.durationMinutes, 0.5);
    assert.equal('user' in first || 'source' in first, false);
  });

  test('recentWorkouts are the newest five, newest first', async () => {
    await completeAll();
    const s = await statsWith();
    assert.equal(s.history, undefined);
    assert.deepEqual(s.recentWorkouts.map((w) => new Date(w.completedAt).getTime()), times.slice(-5).reverse());
  });

  test('historyLimit bounds the response and reports truncation', async () => {
    await completeAll();
    const s = await statsWith({ include: 'history', historyLimit: '10' });
    assert.deepEqual(s.history.map((h) => new Date(h.completedAt).getTime()), times.slice(-10));
    assert.equal(s.historyInfo.truncated, true);
    assert.equal(s.historyInfo.total, 120);
    assert.equal((await statsWith({ include: 'history', historyLimit: 999999 })).historyInfo.limit, 5000);
  });

  test('invalid history params -> 400', async () => {
    useUser(makeUser());
    for (const query of [{ from: 'nope' }, { to: 'nope' }, { from: '2026-02-01', to: '2026-01-01' }, { historyLimit: '0' }, { historyLimit: 'x' }]) {
      assert.equal((await service.getWorkoutStatistics('u1', { include: 'history', ...query })).code, 400, JSON.stringify(query));
    }
  });
});

describe('weekly summary with more than 50 sessions in two weeks', () => {
  test('counts all 70 sessions (40 last week, 30 this week)', async () => {
    const { user } = useUser(makeUser());
    const lastMonday = Date.UTC(2026, 10, 2, 6);
    const thisMonday = Date.UTC(2026, 10, 9, 6);
    for (let i = 0; i < 40; i++) await completeAt(lastMonday + i * 3 * 3600000, { durationSeconds: 100, caloriesBurned: 10 });
    for (let i = 0; i < 30; i++) await completeAt(thisMonday + i * 3 * 3600000, { durationSeconds: 50, caloriesBurned: 5 });
    assert.equal(user.workoutHistory.length, 50);

    const { thisWeek, lastWeek, delta, daily } = (await service.getWeeklySummary('u1', { tz: 'UTC' }, new Date('2026-11-14T12:00:00Z'))).data;
    assert.deepEqual(lastWeek, { workouts: 40, seconds: 4000, calories: 400, minutes: 66.67 });
    assert.deepEqual(thisWeek, { workouts: 30, seconds: 1500, calories: 150, minutes: 25 });
    assert.equal(delta.workouts, -10);
    assert.equal(sum(daily, (d) => d.workouts), 30);
  });

  test('sessions outside the two weeks are ignored even though the range query has a margin', async () => {
    useUser(makeUser(), { sessions: [session('2026-11-01T23:00:00Z'), session('2026-11-16T01:00:00Z'), session('2026-11-02T00:30:00Z')] });
    const { thisWeek, lastWeek } = (await service.getWeeklySummary('u1', { tz: 'UTC' }, new Date('2026-11-14T12:00:00Z'))).data;
    assert.equal(lastWeek.workouts, 1);
    assert.equal(thisWeek.workouts, 0);
  });
});

describe('migrated, unmigrated and legacy users: no double counting', () => {
  // Shape of the one real legacy record.
  const legacyEntry = () => ({ _id: new Types.ObjectId('6af86ada4bfdc6f87f055077'), durationMinutes: 1, caloriesBurned: 200, completedAt: new Date('2026-05-10T10:00:00Z'), workoutName: 'Old' });

  test('unmigrated legacy user: embedded entry is read from the cache, new sessions from both, each once', async () => {
    const legacy = legacyEntry();
    const { user, sessionStore } = useUser(makeUser({ totalWorkouts: 1, totalCaloriesBurned: 200, totalWorkoutTimeMinutes: 1, averageWorkoutTimeMinutes: 1, workoutHistory: [legacy] }));
    await completeAt('2026-11-10T08:00:00Z', { durationSeconds: 35, caloriesBurned: 50 });
    await completeAt('2026-11-11T08:00:00Z', { durationSeconds: 40, caloriesBurned: 60 });
    assert.equal(sessionStore.store.length, 2);
    assert.equal(user.workoutHistory.length, 3);

    const s = await statsWith({ include: 'history' });
    assert.equal(s.history.length, 3);
    assert.deepEqual(s.history.map((h) => h.durationSeconds), [60, 35, 40]);
    assert.equal(sum(s.history, (h) => h.durationSeconds), s.totalWorkoutTimeSeconds);
    assert.equal(sum(s.history, (h) => h.caloriesBurned), s.totalCaloriesBurned);
    assert.equal(s.totalWorkouts, 3);

    const page = (await service.getWorkoutHistory('u1', { limit: 2 })).data;
    assert.equal(page.pagination.total, 3);
    assert.equal(page.pagination.totalPages, 2);
    // Legacy entry was not rewritten
    assert.deepEqual(user.workoutHistory[0], legacyEntry());
  });

  test('migrated user: entries in both stores are counted once', async () => {
    const embedded = Array.from({ length: 50 }, (_, i) => ({ _id: oid(), durationSeconds: 60, caloriesBurned: 10, completedAt: new Date(Date.UTC(2026, 3, 1) + i * 86400000) }));
    const olderOnlyInStore = Array.from({ length: 30 }, (_, i) => session(Date.UTC(2025, 6, 1) + i * 86400000));
    const sessions = [...olderOnlyInStore, ...embedded.map((e) => ({ ...e, user: 'u1', source: 'migration' }))];
    useUser(makeUser({ totalWorkouts: 80, totalCaloriesBurned: 800, totalWorkoutTimeSeconds: 4800, workoutHistory: embedded }), { sessions });

    const s = await statsWith({ include: 'history' });
    assert.equal(s.history.length, 80);
    assert.equal(new Set(s.history.map((h) => String(h._id))).size, 80);
    assert.equal(sum(s.history, (h) => h.durationSeconds), s.totalWorkoutTimeSeconds);
    assert.equal((await service.getWorkoutHistory('u1', { limit: 100 })).data.pagination.total, 80);
  });

  test('partially migrated user and a session whose collection write failed', async () => {
    const t = (d) => new Date(Date.UTC(2026, 10, d, 9));
    const embedded = [
      { _id: oid(), durationMinutes: 2, caloriesBurned: 20, completedAt: t(3) }, // legacy, migrated
      { _id: oid(), durationMinutes: 3, caloriesBurned: 30, completedAt: t(4) }, // legacy, not migrated
      { _id: oid(), durationSeconds: 45, durationMinutes: 0.75, caloriesBurned: 40, completedAt: t(10) }, // new, stored
      { _id: oid(), durationSeconds: 55, durationMinutes: 0.92, caloriesBurned: 50, completedAt: t(11) }, // new, store write failed
      { durationMinutes: 4, caloriesBurned: 1, completedAt: t(5) }, // no _id (cannot be in the store)
    ];
    const sessions = [
      { ...embedded[0], user: 'u1', source: 'migration' },
      { _id: embedded[2]._id, user: 'u1', completedAt: t(10), durationSeconds: 45, caloriesBurned: 40, source: 'completion' },
      session(t(1)), // older than the cache, only in the store
    ];
    useUser(makeUser({ totalWorkouts: 6, workoutHistory: embedded }), { sessions });

    const s = await statsWith({ include: 'history' });
    assert.deepEqual(s.history.map((h) => h.durationSeconds), [60, 120, 180, 240, 45, 55]);
    const { thisWeek, lastWeek } = (await service.getWeeklySummary('u1', { tz: 'UTC' }, new Date('2026-11-14T12:00:00Z'))).data;
    assert.deepEqual([thisWeek.workouts, thisWeek.seconds], [2, 100]);
    assert.deepEqual([lastWeek.workouts, lastWeek.seconds], [3, 120 + 180 + 240]);
  });

  test('stats reads never write or mutate the user', async () => {
    const build = () => makeUser({ totalWorkouts: 1, totalWorkoutTimeMinutes: 1, workoutHistory: [legacyEntry()] });
    const user = build();
    const { save, sessionStore } = useUser(user);
    await statsWith({ include: 'history' });
    await service.getWorkoutHistory('u1', {});
    await service.getWeeklySummary('u1');
    assert.equal(save.mock.callCount(), 0);
    assert.equal(sessionStore.create.mock.callCount(), 0);
    assert.equal(sessionStore.insertMissing.mock.callCount(), 0);
    assert.deepEqual(user, build());
  });
});

describe('GET /workouts/history pagination', () => {
  // 37 sessions in the collection plus 8 embedded-only entries interleaved in time, 2 of them sharing a timestamp with stored ones.
  const build = () => {
    const stored = Array.from({ length: 37 }, (_, i) => session(Date.UTC(2026, 0, 1) + i * 86400000, { caloriesBurned: i }));
    const extra = Array.from({ length: 8 }, (_, i) => ({ _id: oid(), durationSeconds: 1, caloriesBurned: 1000 + i, completedAt: new Date(Date.UTC(2026, 0, 1) + (i * 5 + 0.5) * 86400000) }));
    extra[6].completedAt = new Date(stored[30].completedAt);
    extra[7].completedAt = new Date(stored[36].completedAt);
    const migratedInCache = stored.slice(-3).map(({ user, source, ...e }) => e); // also cached, must not repeat
    return { stored, embedded: [...extra, ...migratedInCache] };
  };
  const all = ({ stored, embedded }) => {
    const byId = new Map([...stored, ...embedded].map((e) => [String(e._id), e]));
    return [...byId.values()].sort(history.compareAsc).map((e) => String(e._id));
  };

  for (const order of ['desc', 'asc']) {
    for (const limit of [1, 5, 7, 20, 100]) {
      test(`pages of ${limit} (${order}) cover every session exactly once in order`, async () => {
        const data = build();
        useUser(makeUser({ workoutHistory: data.embedded }), { sessions: data.stored });
        const expected = order === 'asc' ? all(data) : all(data).reverse();
        assert.equal(expected.length, 45);

        const seen = [];
        for (let page = 1; ; page++) {
          const res = await service.getWorkoutHistory('u1', { page: String(page), limit: String(limit), order });
          assert.equal(res.code, 200);
          const { sessions, pagination } = res.data;
          assert.equal(pagination.total, 45);
          assert.equal(pagination.totalPages, Math.ceil(45 / limit));
          seen.push(...sessions.map((s) => String(s._id)));
          if (!pagination.hasMore) break;
          assert.equal(sessions.length, limit);
        }
        assert.deepEqual(seen, expected);
      });
    }
  }

  test('mergePage matches a brute-force merge for every offset', async () => {
    const data = build();
    const storedSorted = [...data.stored].sort((a, b) => history.compareAsc(b, a));
    const fetchStored = async ({ skip, limit }) => storedSorted.slice(skip, skip + limit);
    const embeddedOnly = data.embedded.filter((e) => !data.stored.some((s) => String(s._id) === String(e._id)));
    const expected = all(data).reverse();
    for (let offset = 0; offset <= 46; offset++) {
      for (const limit of [1, 3, 10]) {
        const page = await history.mergePage({ fetchStored, extra: embeddedOnly, order: 'desc', offset, limit });
        assert.deepEqual(page.map((e) => String(e._id)), expected.slice(offset, offset + limit), `offset ${offset} limit ${limit}`);
      }
    }
  });

  test('date range, defaults, clamping and a page past the end', async () => {
    const data = build();
    useUser(makeUser({ workoutHistory: data.embedded }), { sessions: data.stored });
    const ranged = (await service.getWorkoutHistory('u1', { from: '2026-01-10T00:00:00Z', to: '2026-01-20T00:00:00Z', limit: '100' })).data;
    const inRange = all(data).filter((id) => {
      const e = [...data.stored, ...data.embedded].find((x) => String(x._id) === id);
      return e.completedAt >= new Date('2026-01-10T00:00:00Z') && e.completedAt < new Date('2026-01-20T00:00:00Z');
    });
    assert.deepEqual(ranged.sessions.map((s) => String(s._id)), inRange.reverse());
    assert.equal(ranged.pagination.total, inRange.length);

    const def = (await service.getWorkoutHistory('u1', {})).data.pagination;
    assert.deepEqual([def.page, def.limit, def.order], [1, 20, 'desc']);
    assert.equal((await service.getWorkoutHistory('u1', { limit: '1000' })).data.pagination.limit, 100);
    const past = (await service.getWorkoutHistory('u1', { page: '99' })).data;
    assert.deepEqual(past.sessions, []);
    assert.equal(past.pagination.hasMore, false);
  });

  test('invalid params -> 400, unknown user -> 404', async () => {
    useUser(null);
    for (const query of [{ page: '0' }, { page: 'x' }, { limit: '-1' }, { order: 'up' }, { from: 'x' }]) {
      assert.equal((await service.getWorkoutHistory('u1', query)).code, 400, JSON.stringify(query));
    }
    assert.equal((await service.getWorkoutHistory('u1', {})).code, 404);
  });
});

describe('write ordering and failures', () => {
  const body = { durationSeconds: 35, caloriesBurned: 50 };

  // Records the order of dao calls on top of the in-memory fake.
  const traceCalls = (names) => {
    const calls = [];
    for (const name of names) {
      const inner = workoutDao[name];
      mock.method(workoutDao, name, async (...args) => { calls.push(name); return inner(...args); });
    }
    return calls;
  };

  test('claim fails -> error, nothing recorded or counted, a retry records it once', async () => {
    const { user, save, sessionStore } = useUser(makeUser());
    sessionStore.fail('createSession', { times: 3, error: new Error('db down') });
    await assert.rejects(service.completeWorkout('u1', body), /db down/);
    assert.equal(sessionStore.create.mock.callCount(), 3); // bounded retries
    assert.equal(sessionStore.store.length, 0);
    assert.equal(save.mock.callCount(), 0);
    assert.equal(user.totalWorkouts, 0);
    assert.equal(user.workoutHistory.length, 0);

    assert.equal((await service.completeWorkout('u1', body)).code, 200);
    assert.equal(sessionStore.store.length, 1);
    assert.equal(user.totalWorkouts, 1);
  });

  test('the session is claimed before the counters are applied, and marked counted after', async () => {
    const { user, sessionStore } = useUser(makeUser());
    const calls = traceCalls(['createSession', 'applyCompletionToUser', 'markCountersApplied']);
    await service.completeWorkout('u1', body);
    assert.deepEqual(calls, ['createSession', 'applyCompletionToUser', 'markCountersApplied']);
    const [doc] = sessionStore.store;
    assert.equal(String(doc._id), String(user.workoutHistory[0]._id));
    assert.equal(doc.durationSeconds, 35);
    assert.equal('durationMinutes' in doc, false);
    assert.equal(doc.source, 'completion');
    assert.equal(doc.countersApplied, true);
    assert.equal('clientSessionId' in doc, false);
  });

  test('a transient session write failure is retried once', async () => {
    const { sessionStore } = useUser(makeUser(), { failCreate: 1 });
    assert.equal((await service.completeWorkout('u1', body)).code, 200);
    assert.equal(sessionStore.create.mock.callCount(), 2);
    assert.equal(sessionStore.store.length, 1);
  });

  test('claim stored but acknowledgement lost: the retry recognises its own session, counted once', async () => {
    const { user, sessionStore } = useUser(makeUser());
    sessionStore.fail('createSession', { after: true, error: new Error('connection reset') });
    assert.equal((await service.completeWorkout('u1', body)).code, 200);
    assert.equal(sessionStore.create.mock.callCount(), 2);
    assert.equal(sessionStore.store.length, 1);
    assert.equal(user.totalWorkouts, 1);
    assert.equal(user.workoutHistory.length, 1);
  });

  test('an embedded entry missing from the collection is never trimmed, and is picked up by the backfill', async () => {
    // e.g. a completion from before this protocol whose collection write failed.
    const orphan = { _id: oid(), durationSeconds: 35, durationMinutes: 0.58, caloriesBurned: 50, completedAt: new Date('2026-03-01T10:00:00Z') };
    const { user } = useUser(makeUser({ totalWorkouts: 1, totalCaloriesBurned: 50, totalWorkoutTimeSeconds: 35, workoutHistory: [orphan] }));
    const orphanId = String(orphan._id);

    for (let i = 0; i < 60; i++) await completeAt(Date.UTC(2026, 3, 1) + i * 3600000, body);
    assert.equal(user.workoutHistory.length, 51);
    assert.equal(String(user.workoutHistory[0]._id), orphanId);

    let s = await statsWith({ include: 'history' });
    assert.equal(s.history.length, 61);
    assert.equal(s.totalWorkouts, 61);
    assert.equal(sum(s.history, (h) => h.durationSeconds), s.totalWorkoutTimeSeconds);

    // Backfill copies it under the same id; history still counts it once and the next trim drops it from the cache.
    const { migrateUserHistory } = require('./workout.migration');
    const report = await migrateUserHistory({ _id: 'u1', workoutHistory: user.workoutHistory }, { apply: true });
    assert.equal(report.copied, 1);
    s = await statsWith({ include: 'history' });
    assert.equal(s.history.length, 61);
    await completeAt(Date.UTC(2026, 5, 1), body);
    assert.equal(user.workoutHistory.length, 50);
    assert.equal(user.workoutHistory.some((e) => String(e._id) === orphanId), false);
    s = await statsWith({ include: 'history' });
    assert.equal(s.history.length, 62);
    assert.equal(s.totalWorkouts, 62);
  });

  test('if the trim check fails the cache keeps everything and the workout is still recorded', async () => {
    const consoleError = mock.method(console, 'error', () => {});
    const embedded = Array.from({ length: 50 }, (_, i) => ({ _id: oid(), durationSeconds: 1, caloriesBurned: 1, completedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000) }));
    const sessions = embedded.map((e) => ({ ...e, user: 'u1', source: 'migration' }));
    const { user, sessionStore } = useUser(makeUser({ totalWorkouts: 50, workoutHistory: embedded }), { sessions });
    sessionStore.counted.mock.mockImplementation(async () => { throw new Error('timeout'); });
    assert.equal((await service.completeWorkout('u1', body)).code, 200);
    assert.equal(user.workoutHistory.length, 51);
    assert.equal(user.totalWorkouts, 51);
    assert.equal(consoleError.mock.callCount(), 1);
  });
});

describe('WorkoutSession model', () => {
  test('a new completion and a legacy minute-only copy validate; no duration is defaulted', () => {
    const fresh = new WorkoutSession({ _id: oid(), user: oid(), completedAt: new Date(), durationSeconds: 35, caloriesBurned: 10, source: 'completion' });
    assert.equal(fresh.validateSync(), undefined);
    assert.equal(fresh.durationMinutes, undefined);

    const legacy = new WorkoutSession({ _id: oid(), user: oid(), completedAt: new Date(), durationMinutes: 1, caloriesBurned: 200, workoutName: 'Old', source: 'migration' });
    assert.equal(legacy.validateSync(), undefined);
    assert.equal(legacy.durationSeconds, undefined);
    assert.equal('durationSeconds' in legacy.toObject(), false);
    assert.equal(entrySeconds(legacy.toObject()), 60);
  });

  test('indexed on { user, completedAt }', () => {
    const keys = WorkoutSession.schema.indexes().map(([k]) => Object.keys(k).join(','));
    assert.ok(keys.includes('user,completedAt,_id'));
  });

  test('hydrated user: completion shares the embedded _id with the session and the cache entry validates', async () => {
    const doc = User.hydrate({ _id: oid(), email: 'a@b.co', firstName: 'A', lastName: 'B', totalWorkouts: 0, workoutHistory: [] });
    const { sessionStore } = useUser(doc);
    await service.completeWorkout(String(doc._id), { durationSeconds: 35, caloriesBurned: 10 });
    assert.equal(String(sessionStore.store[0].user), String(doc._id));
    assert.equal(String(sessionStore.store[0]._id), String(doc.workoutHistory[0]._id));
    assert.equal(doc.validateSync(['workoutHistory']), undefined);
    assert.equal(new WorkoutSession(sessionStore.store[0]).validateSync(), undefined);
  });
});
