const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const workoutDao = require('./workout.dao');
const service = require('./workout.service');
const { installSessionStore } = require('./workout.testkit');
const userService = require('../user/user.service');
const { resolveDurationSeconds, entrySeconds, userTotalSeconds, userAverageSeconds } = require('./workout.duration');

// Stand-in for the Mongoose user document; the dao is an in-memory fake so nothing touches the database.
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

const complete = (durationSeconds, extra = {}) => service.completeWorkout('u1', { caloriesBurned: 200, durationSeconds, ...extra });
const stats = async () => (await service.getWorkoutStatistics('u1')).data.statistics;

afterEach(() => mock.restoreAll());

describe('completeWorkout stores the real duration in seconds', () => {
  for (const seconds of [35, 59, 60, 90, 2100, 4500]) {
    test(`${seconds}s workout is stored and reported as ${seconds}s`, async () => {
      const { user, save } = useUser(makeUser());
      const res = await complete(seconds);

      assert.equal(res.code, 200);
      assert.equal(save.mock.callCount(), 1);
      assert.equal(user.workoutHistory[0].durationSeconds, seconds);
      assert.equal(user.totalWorkoutTimeSeconds, seconds);
      assert.equal(res.data.statistics.totalWorkoutTimeSeconds, seconds);
      assert.equal(res.data.statistics.averageWorkoutTimeSeconds, seconds);
      assert.equal(res.data.statistics.totalWorkouts, 1);
      assert.equal(res.data.statistics.totalCaloriesBurned, 200);

      const s = await stats();
      assert.equal(s.totalWorkoutTimeSeconds, seconds);
      assert.equal(s.averageWorkoutTimeSeconds, seconds);
      assert.equal(s.recentWorkouts[0].durationSeconds, seconds);
    });
  }

  test('a 35 second workout is not rounded up to a minute anywhere', async () => {
    const { user } = useUser(makeUser());
    await complete(35);
    assert.equal(user.totalWorkoutTimeMinutes, 0.58);
    assert.equal(user.averageWorkoutTimeMinutes, 0.58);
    assert.equal(user.workoutHistory[0].durationMinutes, 0.58);
  });

  test('multiple workouts: total is the sum and average is total / count', async () => {
    const { user } = useUser(makeUser());
    for (const seconds of [35, 90, 2100, 4500]) await complete(seconds, { caloriesBurned: 100 });

    const s = await stats();
    assert.equal(s.totalWorkouts, 4);
    assert.equal(s.totalCaloriesBurned, 400);
    assert.equal(s.totalWorkoutTimeSeconds, 6725);
    assert.equal(s.averageWorkoutTimeSeconds, 1681); // 6725 / 4 = 1681.25
    assert.deepEqual(s.recentWorkouts.map((w) => w.durationSeconds), [4500, 2100, 90, 35]);
    assert.equal(user.workoutHistory.length, 4);
  });

  test('lifetime total keeps growing past the 50-entry history cap', async () => {
    const { user } = useUser(makeUser());
    for (let i = 0; i < 55; i++) await complete(35);
    assert.equal(user.workoutHistory.length, 50);
    assert.equal(user.totalWorkouts, 55);
    assert.equal(user.totalWorkoutTimeSeconds, 55 * 35);
    assert.equal((await stats()).averageWorkoutTimeSeconds, 35);
  });

  test('legacy clients sending durationMinutes are converted to seconds', async () => {
    const { user } = useUser(makeUser());
    const res = await service.completeWorkout('u1', { caloriesBurned: 50, durationMinutes: 35 });
    assert.equal(res.code, 200);
    assert.equal(user.workoutHistory[0].durationSeconds, 2100);
  });

  test('zero calories is accepted', async () => {
    useUser(makeUser());
    assert.equal((await complete(35, { caloriesBurned: 0 })).code, 200);
  });
});

describe('existing minute-only records', () => {
  const legacyUser = () => makeUser({
    totalWorkouts: 2,
    totalCaloriesBurned: 500,
    totalWorkoutTimeMinutes: 80,
    averageWorkoutTimeMinutes: 40,
    workoutHistory: [
      { durationMinutes: 35, caloriesBurned: 200, completedAt: new Date(), workoutName: 'A' },
      { durationMinutes: 45, caloriesBurned: 300, completedAt: new Date(), workoutName: 'B' },
    ],
  });

  test('are read as minutes * 60 without being rewritten', async () => {
    const { user, save } = useUser(legacyUser());
    const s = await stats();
    assert.equal(s.totalWorkoutTimeSeconds, 4800);
    assert.equal(s.averageWorkoutTimeSeconds, 2400);
    assert.deepEqual(s.recentWorkouts.map((w) => w.durationSeconds), [2700, 2100]);
    assert.equal(save.mock.callCount(), 0);
    assert.equal(user.totalWorkoutTimeSeconds, undefined);
    assert.equal(user.workoutHistory[0].durationSeconds, undefined);
  });

  test('a new workout is added on top of the legacy total', async () => {
    const { user } = useUser(legacyUser());
    await complete(35);
    assert.equal(user.totalWorkoutTimeSeconds, 4835);
    assert.equal(user.totalWorkouts, 3);
    assert.equal((await stats()).averageWorkoutTimeSeconds, 1612); // 4835 / 3
    assert.equal(user.workoutHistory[0].durationMinutes, 35); // old entry untouched
  });

  test('profile stats endpoint reports seconds too', async () => {
    const user = { ...legacyUser(), isProfileComplete: () => true, createdAt: new Date() };
    const { stats: s } = (await userService.getUserStats(user)).data;
    assert.equal(s.avgWorkoutSeconds, 2400);
    assert.equal(s.totalWorkoutTimeSeconds, 4800);
    assert.equal(s.avgWorkout, 40);
  });
});

describe('invalid or missing durations are rejected', () => {
  for (const [label, body] of [
    ['missing duration', { caloriesBurned: 200 }],
    ['null duration', { caloriesBurned: 200, durationSeconds: null }],
    ['negative duration', { caloriesBurned: 200, durationSeconds: -5 }],
    ['non-numeric duration', { caloriesBurned: 200, durationSeconds: 'abc' }],
    ['NaN duration', { caloriesBurned: 200, durationSeconds: NaN }],
    ['absurdly long duration', { caloriesBurned: 200, durationSeconds: 25 * 60 * 60 }],
    ['missing calories', { durationSeconds: 35 }],
    ['negative calories', { durationSeconds: 35, caloriesBurned: -1 }],
    ['no body', undefined],
  ]) {
    test(`${label} -> 400 and nothing saved`, async () => {
      const { user, save } = useUser(makeUser());
      const res = await service.completeWorkout('u1', body);
      assert.equal(res.code, 400);
      assert.equal(save.mock.callCount(), 0);
      assert.equal(user.totalWorkouts, 0);
    });
  }

  test('unknown user -> 404', async () => {
    useUser(null);
    assert.equal((await complete(35)).code, 404);
  });
});

describe('getWeeklySummary aggregates seconds', () => {
  test('sums sub-minute sessions without per-session rounding', async () => {
    const now = new Date();
    useUser(makeUser({
      workoutHistory: [
        { durationSeconds: 35, caloriesBurned: 100, completedAt: now },
        { durationSeconds: 35, caloriesBurned: 100, completedAt: now },
        { durationMinutes: 35, caloriesBurned: 300, completedAt: now }, // legacy entry
      ],
    }));
    const { thisWeek, lastWeek, delta, daily } = (await service.getWeeklySummary('u1')).data;
    assert.equal(thisWeek.workouts, 3);
    assert.equal(thisWeek.seconds, 2170);
    assert.equal(thisWeek.minutes, 36.17);
    assert.equal(thisWeek.calories, 500);
    assert.equal(lastWeek.seconds, 0);
    assert.equal(delta.seconds, 2170);
    assert.equal(daily.length, 7);
    assert.equal(daily.reduce((t, d) => t + d.seconds, 0), 2170);
  });
});

describe('getWeeklySummary buckets days in the client time zone', () => {
  // Saturday 2026-11-14, 12:00 UTC.
  const now = new Date('2026-11-14T12:00:00Z');
  const summary = async (tz) => (await service.getWeeklySummary('u1', tz ? { tz } : {}, now)).data;
  const entry = (iso, extra = {}) => ({ durationSeconds: 60, caloriesBurned: 10, completedAt: new Date(iso), ...extra });

  test('week runs Monday to Sunday with day keys matching the calendar', async () => {
    useUser(makeUser({ workoutHistory: [entry('2026-11-14T10:00:00Z')] }));
    const { daily, today } = await summary('UTC');
    assert.equal(today, '2026-11-14');
    assert.deepEqual(daily.map((d) => d.date), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    assert.equal(daily.find((d) => d.date === '2026-11-14').workouts, 1);
  });

  test('a workout just after local midnight lands on the local day, not the UTC day', async () => {
    // 2026-11-14 00:30 in Kolkata (+05:30) is still 2026-11-13 in UTC.
    useUser(makeUser({ workoutHistory: [entry('2026-11-13T19:00:00Z')] }));
    const { daily } = await summary('Asia/Kolkata');
    assert.equal(daily.find((d) => d.date === '2026-11-14').workouts, 1);
    assert.equal(daily.find((d) => d.date === '2026-11-13').workouts, 0);
  });

  test('a Sunday-evening workout west of UTC counts for that week, not the next one', async () => {
    // Sunday 2026-11-08 20:00 in Los Angeles is Monday 04:00 UTC (this week in UTC terms).
    useUser(makeUser({ workoutHistory: [entry('2026-11-09T04:00:00Z')] }));
    const { thisWeek, lastWeek } = await summary('America/Los_Angeles');
    assert.equal(thisWeek.workouts, 0);
    assert.equal(lastWeek.workouts, 1);
    assert.equal(lastWeek.seconds, 60);
  });

  test('older workouts, entries without a date and an invalid tz are handled', async () => {
    useUser(makeUser({ workoutHistory: [entry('2026-10-01T10:00:00Z'), { durationSeconds: 60 }, entry('not a date')] }));
    const res = await service.getWeeklySummary('u1', { tz: 'Not/AZone' }, now);
    assert.equal(res.code, 200);
    assert.equal(res.data.thisWeek.workouts, 0);
    assert.equal(res.data.lastWeek.workouts, 0);
  });

  test('empty history returns zeros, never NaN', async () => {
    useUser(makeUser());
    const { thisWeek, lastWeek, delta, daily } = await summary('UTC');
    for (const o of [thisWeek, lastWeek, delta, ...daily]) {
      for (const k of ['workouts', 'seconds', 'minutes', 'calories']) assert.equal(o[k], 0, k);
    }
  });
});

describe('getWorkoutStatistics include=history', () => {
  test('returns the full history in seconds only when asked', async () => {
    const workoutHistory = Array.from({ length: 7 }, (_, i) => ({ durationMinutes: i + 1, caloriesBurned: 10, completedAt: new Date() }));
    useUser(makeUser({ totalWorkouts: 7, workoutHistory }));
    const without = (await service.getWorkoutStatistics('u1')).data.statistics;
    assert.equal(without.history, undefined);
    assert.equal(without.recentWorkouts.length, 5);

    const withHistory = (await service.getWorkoutStatistics('u1', { include: 'history' })).data.statistics;
    assert.equal(withHistory.history.length, 7);
    assert.deepEqual(withHistory.history.map((h) => h.durationSeconds), [60, 120, 180, 240, 300, 360, 420]);
  });

  test('empty history', async () => {
    useUser(makeUser());
    const s = (await service.getWorkoutStatistics('u1', { include: 'history' })).data.statistics;
    assert.deepEqual(s.history, []);
    assert.equal(s.averageWorkoutTimeSeconds, 0);
    assert.equal(s.totalWorkoutTimeSeconds, 0);
  });
});

describe('duration helpers', () => {
  test('resolveDurationSeconds', () => {
    assert.equal(resolveDurationSeconds({ durationSeconds: 35 }), 35);
    assert.equal(resolveDurationSeconds({ durationSeconds: '90' }), 90);
    assert.equal(resolveDurationSeconds({ durationSeconds: 35.4 }), 35);
    assert.equal(resolveDurationSeconds({ durationSeconds: 0 }), 0);
    assert.equal(resolveDurationSeconds({ durationSeconds: 35, durationMinutes: 1 }), 35);
    assert.equal(resolveDurationSeconds({ durationMinutes: 1.5 }), 90);
    assert.equal(resolveDurationSeconds({}), null);
    assert.equal(resolveDurationSeconds({ durationSeconds: '' }), null);
    assert.equal(resolveDurationSeconds({ durationSeconds: true }), null);
  });

  test('entry and user fallbacks', () => {
    assert.equal(entrySeconds({ durationSeconds: 35, durationMinutes: 1 }), 35);
    assert.equal(entrySeconds({ durationMinutes: 1 }), 60);
    assert.equal(entrySeconds({}), 0);
    assert.equal(userTotalSeconds({ totalWorkoutTimeSeconds: 0, totalWorkoutTimeMinutes: 5 }), 0);
    assert.equal(userTotalSeconds({ totalWorkoutTimeMinutes: 5 }), 300);
    assert.equal(userAverageSeconds({ totalWorkouts: 0 }), 0);
  });
});
