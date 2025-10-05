const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const workoutDao = require('./workout.dao');
const service = require('./workout.service');
const { installSessionStore } = require('./workout.testkit');
const userService = require('../user/user.service');
const User = require('../user/user.model');
const { entrySeconds, userTotalSeconds, userAverageSeconds } = require('./workout.duration');

// Mixed legacy (minutes-only) and new (seconds) records. The dao is mocked; nothing touches the database.

const makeUser = (overrides = {}) => ({
  totalWorkouts: 0,
  totalCaloriesBurned: 0,
  totalWorkoutTimeMinutes: 0,
  averageWorkoutTimeMinutes: 0,
  workoutHistory: [],
  ...overrides,
});

// The WorkoutSession store is an in-memory fake (workout.testkit.js), empty unless `sessions` is given.
// `save` is the atomic counter update (the only write to the user document on completion).
const useUser = (user, { sessions } = {}) => {
  mock.method(workoutDao, 'findUserById', async () => user);
  const sessionStore = installSessionStore({ sessions });
  return { user, save: sessionStore.applyUser, sessionStore };
};

const complete = (durationSeconds, extra = {}) => service.completeWorkout('u1', { caloriesBurned: 100, durationSeconds, ...extra });
const stats = async () => (await service.getWorkoutStatistics('u1')).data.statistics;
const profileStats = async (user) => (await userService.getUserStats({ ...user, isProfileComplete: () => true, createdAt: new Date() })).data.stats;

// Shape of the one real legacy record: old client saved a ~35s workout as 1 minute.
const legacyDoc = () => ({
  _id: '6af86564a4a4013c286ff4be',
  email: 'legacy@example.com',
  firstName: 'L',
  lastName: 'U',
  totalWorkouts: 1,
  totalCaloriesBurned: 200,
  totalWorkoutTimeMinutes: 1,
  averageWorkoutTimeMinutes: 1,
  workoutHistory: [{ _id: '6af86ada4bfdc6f87f055077', durationMinutes: 1, caloriesBurned: 200, completedAt: new Date(), workoutName: 'Old' }],
});

afterEach(() => mock.restoreAll());

describe('(a) legacy minutes total is carried into seconds exactly once', () => {
  test('plain object: first new workout converts, second only adds', async () => {
    const { user } = useUser(makeUser(legacyDoc()));
    await complete(35);
    assert.equal(user.totalWorkoutTimeSeconds, 60 + 35);
    await complete(40);
    assert.equal(user.totalWorkoutTimeSeconds, 60 + 35 + 40);
    await complete(25);
    assert.equal(user.totalWorkoutTimeSeconds, 60 + 35 + 40 + 25);
    assert.equal(user.totalWorkouts, 4);
    assert.equal(user.totalWorkoutTimeMinutes, 2.67); // 160s
    assert.equal((await stats()).totalWorkoutTimeSeconds, 160);
  });

  test('hydrated Mongoose document: absent field is undefined, not defaulted to 0', async () => {
    const doc = User.hydrate(legacyDoc());
    assert.equal(doc.totalWorkoutTimeSeconds, undefined);
    assert.equal(doc.workoutHistory[0].durationSeconds, undefined);
    assert.equal(userTotalSeconds(doc), 60);

    useUser(doc);
    await complete(35);
    assert.equal(doc.totalWorkoutTimeSeconds, 95);
    await complete(35);
    assert.equal(doc.totalWorkoutTimeSeconds, 130);
    assert.equal(doc.totalWorkouts, 3);
    assert.equal(doc.validateSync(['totalWorkoutTimeSeconds', 'workoutHistory', 'totalWorkouts', 'totalCaloriesBurned']), undefined);

    const s = await stats();
    assert.equal(s.totalWorkoutTimeSeconds, 130);
    assert.equal(s.averageWorkoutTimeSeconds, 43); // 130 / 3
    assert.deepEqual(s.recentWorkouts.map((w) => w.durationSeconds), [35, 35, 60]);
  });

  test('fractional legacy minutes total converts to rounded seconds once', async () => {
    const { user } = useUser(makeUser({ totalWorkouts: 1, totalWorkoutTimeMinutes: 0.58 }));
    await complete(10);
    assert.equal(user.totalWorkoutTimeSeconds, 35 + 10);
    await complete(10);
    assert.equal(user.totalWorkoutTimeSeconds, 55);
  });
});

describe('(b) an entry with both fields: seconds wins, never summed', () => {
  test('entrySeconds prefers durationSeconds', () => {
    assert.equal(entrySeconds({ durationSeconds: 35, durationMinutes: 0.58 }), 35);
    assert.equal(entrySeconds({ durationSeconds: 35, durationMinutes: 1 }), 35);
    assert.equal(entrySeconds({ durationSeconds: 0, durationMinutes: 1 }), 0);
  });

  test('user total prefers seconds over minutes', () => {
    assert.equal(userTotalSeconds({ totalWorkoutTimeSeconds: 95, totalWorkoutTimeMinutes: 1.58 }), 95);
  });

  test('stats and weekly summary use seconds only for dual-field entries', async () => {
    const now = new Date();
    useUser(makeUser({
      totalWorkouts: 1,
      totalWorkoutTimeSeconds: 35,
      totalWorkoutTimeMinutes: 1, // stale/inconsistent minutes must be ignored
      workoutHistory: [{ durationSeconds: 35, durationMinutes: 1, caloriesBurned: 50, completedAt: now }],
    }));
    const s = await stats();
    assert.equal(s.totalWorkoutTimeSeconds, 35);
    assert.equal(s.recentWorkouts[0].durationSeconds, 35);
    assert.equal(s.recentWorkouts[0].durationMinutes, 0.58);
    const { thisWeek } = (await service.getWeeklySummary('u1')).data;
    assert.equal(thisWeek.seconds, 35);
  });

  test('completion request with both fields uses seconds', async () => {
    const { user } = useUser(makeUser());
    await service.completeWorkout('u1', { caloriesBurned: 10, durationSeconds: 35, durationMinutes: 1 });
    assert.equal(user.workoutHistory[0].durationSeconds, 35);
    assert.equal(user.totalWorkoutTimeSeconds, 35);
  });
});

describe('(c) averages are total seconds / totalWorkouts with mixed records', () => {
  test('legacy 2 x minute workouts + 2 new second workouts', async () => {
    const { user } = useUser(makeUser({
      totalWorkouts: 2,
      totalWorkoutTimeMinutes: 80,
      averageWorkoutTimeMinutes: 40,
      workoutHistory: [
        { durationMinutes: 35, caloriesBurned: 200, completedAt: new Date() },
        { durationMinutes: 45, caloriesBurned: 300, completedAt: new Date() },
      ],
    }));
    await complete(35);
    await complete(65);
    const expectedTotal = 4800 + 35 + 65; // 4900
    const s = await stats();
    assert.equal(s.totalWorkoutTimeSeconds, expectedTotal);
    assert.equal(s.averageWorkoutTimeSeconds, Math.round(expectedTotal / 4)); // 1225
    assert.equal(s.averageWorkoutTimeMinutes, 20.42);
    assert.equal(user.averageWorkoutTimeMinutes, 20.42);
    const p = await profileStats(user);
    assert.equal(p.avgWorkoutSeconds, 1225);
    assert.equal(p.totalWorkoutTimeSeconds, expectedTotal);
    assert.equal(p.avgWorkout, 20.42);
  });

  test('average uses lifetime totalWorkouts, not history length', () => {
    const user = { totalWorkouts: 10, totalWorkoutTimeSeconds: 1000, workoutHistory: [{ durationSeconds: 5 }] };
    assert.equal(userAverageSeconds(user), 100);
  });
});

describe('(d) 50-entry history cache does not affect lifetime totals', () => {
  const { Types } = require('mongoose');
  const legacyHistory = () => Array.from({ length: 50 }, (_, i) => ({ _id: new Types.ObjectId(), durationMinutes: 1, caloriesBurned: 10, completedAt: new Date(2020, 0, 1 + i) }));

  const assertTotals = async (user) => {
    assert.equal(user.totalWorkouts, 125);
    assert.equal(user.totalCaloriesBurned, 1250);
    assert.equal(user.totalWorkoutTimeSeconds, 120 * 60 + 5 * 30);

    const historySum = user.workoutHistory.reduce((t, e) => t + entrySeconds(e), 0);
    assert.notEqual(historySum, user.totalWorkoutTimeSeconds);

    const s = await stats();
    assert.equal(s.totalWorkouts, 125);
    assert.equal(s.totalWorkoutTimeSeconds, 7350);
    assert.equal(s.averageWorkoutTimeSeconds, Math.round(7350 / 125));
    assert.equal(s.totalCaloriesBurned, 1250);

    const p = await profileStats(user);
    assert.equal(p.totalWorkoutTimeSeconds, 7350);
    assert.equal(p.totalWorkouts, 125);
    assert.equal(p.caloriesBurned, 1250);
  };

  test('migrated legacy user: cache trimmed to 50, totals keep growing; no reader recomputes from history', async () => {
    const history = legacyHistory();
    const sessions = history.map(({ _id, ...e }) => ({ _id, user: 'u1', ...e, source: 'migration' }));
    const { user, sessionStore } = useUser(makeUser({ totalWorkouts: 120, totalCaloriesBurned: 1200, totalWorkoutTimeMinutes: 120, workoutHistory: history }), { sessions });
    for (let i = 0; i < 5; i++) await complete(30, { caloriesBurned: 10 });

    assert.equal(user.workoutHistory.length, 50);
    // Oldest five legacy entries dropped from the cache (they are in the collection), remaining 45 legacy + 5 new
    assert.equal(user.workoutHistory.filter((e) => e.durationSeconds === undefined).length, 45);
    assert.equal(sessionStore.store.length, 55);
    await assertTotals(user);
  });

  test('unmigrated legacy user: entries missing from the collection are never trimmed away', async () => {
    const history = legacyHistory();
    const { user, sessionStore } = useUser(makeUser({ totalWorkouts: 120, totalCaloriesBurned: 1200, totalWorkoutTimeMinutes: 120, workoutHistory: history }));
    for (let i = 0; i < 5; i++) await complete(30, { caloriesBurned: 10 });

    assert.equal(user.workoutHistory.length, 55);
    assert.equal(user.workoutHistory.filter((e) => e.durationSeconds === undefined).length, 50);
    assert.equal(sessionStore.store.length, 5);
    await assertTotals(user);
  });
});

describe('(e) weekly summary with mixed entries', () => {
  test('mixes seconds, minute-only, dual-field and empty entries across weeks', async () => {
    const now = new Date();
    const lastWeek = new Date(now); lastWeek.setDate(now.getDate() - 7);
    const longAgo = new Date(now); longAgo.setDate(now.getDate() - 30);
    useUser(makeUser({
      workoutHistory: [
        { durationMinutes: 10, caloriesBurned: 1000, completedAt: longAgo }, // outside both weeks
        { durationMinutes: 1, caloriesBurned: 200, completedAt: lastWeek }, // legacy last week: 60s
        { durationSeconds: 20, durationMinutes: 0.33, caloriesBurned: 5, completedAt: lastWeek }, // dual: 20s
        { durationSeconds: 35, durationMinutes: 0.58, caloriesBurned: 50, completedAt: now }, // dual: 35s
        { durationMinutes: 2, caloriesBurned: 70, completedAt: now }, // legacy: 120s
        { caloriesBurned: 7, completedAt: now }, // neither field: 0s, still a workout
      ],
    }));
    const { thisWeek, lastWeek: lw, delta, daily } = (await service.getWeeklySummary('u1')).data;
    assert.deepEqual(thisWeek, { workouts: 3, seconds: 155, calories: 127, minutes: 2.58 });
    assert.deepEqual(lw, { workouts: 2, seconds: 80, calories: 205, minutes: 1.33 });
    assert.equal(delta.seconds, 75);
    assert.equal(delta.minutes, 1.25);
    assert.equal(daily.reduce((t, d) => t + d.seconds, 0), 155);
  });
});

describe('(f) totalWorkoutTimeSeconds: 0 vs undefined/null', () => {
  test('real zero seconds does not fall back to legacy minutes', () => {
    assert.equal(userTotalSeconds({ totalWorkoutTimeSeconds: 0, totalWorkoutTimeMinutes: 7 }), 0);
    assert.equal(userAverageSeconds({ totalWorkouts: 1, totalWorkoutTimeSeconds: 0, totalWorkoutTimeMinutes: 7 }), 0);
  });

  test('undefined or null seconds falls back to minutes', () => {
    assert.equal(userTotalSeconds({ totalWorkoutTimeMinutes: 7 }), 420);
    assert.equal(userTotalSeconds({ totalWorkoutTimeSeconds: undefined, totalWorkoutTimeMinutes: 7 }), 420);
    assert.equal(userTotalSeconds({ totalWorkoutTimeSeconds: null, totalWorkoutTimeMinutes: 7 }), 420);
    assert.equal(entrySeconds({ durationSeconds: null, durationMinutes: 1 }), 60);
  });

  test('user with a real 0s workout then another workout does not pick up minutes', async () => {
    const { user } = useUser(makeUser());
    await complete(0);
    assert.equal(user.totalWorkoutTimeSeconds, 0);
    user.totalWorkoutTimeMinutes = 5; // simulate a stale minutes value; must be ignored
    await complete(10);
    assert.equal(user.totalWorkoutTimeSeconds, 10);
  });

  test('brand-new user (both absent) starts from zero', async () => {
    const { user } = useUser({ workoutHistory: [] });
    await complete(35);
    assert.equal(user.totalWorkoutTimeSeconds, 35);
    assert.equal(user.totalWorkouts, 1);
    assert.equal(user.totalCaloriesBurned, 100);
  });

  test('hydrated doc with stored 0 keeps 0 (no default masking)', () => {
    const doc = User.hydrate({ ...legacyDoc(), totalWorkoutTimeSeconds: 0 });
    assert.equal(doc.totalWorkoutTimeSeconds, 0);
    assert.equal(userTotalSeconds(doc), 0);
  });
});

describe('(g) calories and existing history entries are preserved', () => {
  test('old entries are not mutated and calories accumulate exactly', async () => {
    const legacy = legacyDoc();
    const before = structuredClone(legacy.workoutHistory[0]);
    const { user } = useUser(makeUser(legacy));
    await complete(35, { caloriesBurned: 49.6 });
    assert.equal(user.totalCaloriesBurned, 250);
    assert.deepEqual(user.workoutHistory[0], before);
    assert.equal(user.workoutHistory[1].caloriesBurned, 50);
    assert.equal(user.workoutHistory[1].durationSeconds, 35);
  });

  test('reads (stats, weekly, profile) never save or mutate', async () => {
    const legacy = makeUser(legacyDoc());
    const snapshot = structuredClone(legacy);
    const { save } = useUser(legacy);
    await stats();
    await service.getWeeklySummary('u1');
    await profileStats(legacy);
    assert.equal(save.mock.callCount(), 0);
    assert.deepEqual(legacy, snapshot);
  });

  test('profile update cannot overwrite totals or history', async () => {
    const userDao = require('../user/user.dao');
    const update = mock.method(userDao, 'updateById', async (_id, data) => data);
    await userService.updateProfile('u1', {
      bio: 'x', totalWorkoutTimeSeconds: 1, totalWorkoutTimeMinutes: 1, averageWorkoutTimeMinutes: 1,
      totalWorkouts: 1, totalCaloriesBurned: 1, workoutHistory: [],
    });
    const data = update.mock.calls[0].arguments[1];
    for (const k of ['totalWorkoutTimeSeconds', 'totalWorkoutTimeMinutes', 'averageWorkoutTimeMinutes', 'totalWorkouts', 'totalCaloriesBurned', 'workoutHistory']) {
      assert.equal(k in data, false, k);
    }
  });
});

describe('(h) nothing estimates or rewrites missing historical seconds', () => {
  test('completing a workout leaves legacy entries without durationSeconds', async () => {
    const doc = User.hydrate(legacyDoc());
    useUser(doc);
    await complete(35);
    assert.equal(doc.workoutHistory[0].durationSeconds, undefined);
    assert.equal(doc.workoutHistory[0].durationMinutes, 1);
    // push() marks the array modified, but the persisted legacy subdocument gains no seconds field
    assert.equal('durationSeconds' in doc.workoutHistory[0].toObject(), false);
    assert.equal(doc.toObject().workoutHistory[0].durationMinutes, 1);
  });

  test('stats response derives seconds for display only', async () => {
    const legacy = makeUser(legacyDoc());
    useUser(legacy);
    const s = await stats();
    assert.equal(s.recentWorkouts[0].durationSeconds, 60);
    assert.equal(legacy.workoutHistory[0].durationSeconds, undefined);
    assert.equal(legacy.totalWorkoutTimeSeconds, undefined);
  });
});
