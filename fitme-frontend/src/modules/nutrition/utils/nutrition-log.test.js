import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNutritionLog,
  recordCompletedMeal,
  dayTotals,
  todayTotals,
  totalsBetween,
  bucketNutritionLog,
  restoreDailyTasks,
  serializeDailyTasks,
  isCurrentDailyTasks,
} from './nutrition-log.js';
import { buildPeriodBuckets, bucketWorkoutHistory } from '../../analytics/utils/period-buckets.js';
import { legacyUtcDateKey, toLocalDateKey } from '../../../utils/local-date.js';

// Instants are built with local constructors so the expectations hold in every TZ the suite runs under.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const meal = (name, calories, time = '8:00 AM', extra = {}) => ({ time, name, calories, protein: 10, carbs: 20, fat: 5, ...extra });
const log = (...entries) => entries.reduce((acc, [task, now]) => recordCompletedMeal(acc, task, now).log, {});
const sumAll = (l) => Object.values(l).reduce((s, v) => s + (v.calories || 0), 0);

describe('recordCompletedMeal', () => {
  test('a meal just after local midnight counts for the new day', () => {
    const { log: l, dayKey } = recordCompletedMeal({}, meal('Oats', 300), at(2026, 11, 15, 0, 5));
    assert.equal(dayKey, '2026-11-15');
    assert.deepEqual(Object.keys(l), ['2026-11-15']);
    assert.equal(todayTotals(l, at(2026, 11, 15, 9)).calories, 300);
  });

  test('a meal just before local midnight counts for that day, not tomorrow', () => {
    const { dayKey } = recordCompletedMeal({}, meal('Snack', 150), at(2026, 11, 14, 23, 55));
    assert.equal(dayKey, '2026-11-14');
  });

  test('adds macros and does not count the same meal twice in a day', () => {
    let l = {};
    l = recordCompletedMeal(l, meal('Oats', 300), at(2026, 11, 14, 8)).log;
    const again = recordCompletedMeal(l, meal('Oats', 300), at(2026, 11, 14, 9));
    assert.equal(again.added, false);
    assert.equal(again.log, l);
    l = recordCompletedMeal(l, meal('Rice', 500, '1:00 PM'), at(2026, 11, 14, 13)).log;
    assert.deepEqual(dayTotals(l, '2026-11-14'), { calories: 800, protein: 20, carbs: 40, fat: 10 });
    // Same meal the next day is a new entry.
    assert.equal(recordCompletedMeal(l, meal('Oats', 300), at(2026, 11, 15, 8)).added, true);
  });

  test('does not mutate the stored object', () => {
    const before = { '2026-11-14': { calories: 100, protein: 0, carbs: 0, fat: 0, completedMeals: ['x'] } };
    const snapshot = JSON.parse(JSON.stringify(before));
    recordCompletedMeal(before, meal('Oats', 300), at(2026, 11, 14, 8));
    assert.deepEqual(before, snapshot);
  });
});

describe('legacy UTC-day records', () => {
  const legacy = {
    // Written by the old code: UTC-day keys, day totals only, no timestamps.
    '2026-11-13': { calories: 1200, protein: 60, carbs: 150, fat: 40, completedMeals: ['8:00 AM-Oats', '1:00 PM-Rice'] },
    '2026-11-14': { calories: 400, protein: 20, carbs: 50, fat: 10, completedMeals: ['8:00 AM-Oats'] },
  };

  test('are read as the calendar day their key names', () => {
    assert.equal(dayTotals(legacy, '2026-11-13').calories, 1200);
    assert.equal(todayTotals(legacy, at(2026, 11, 14, 0, 1)).calories, 400);
    assert.equal(todayTotals(legacy, at(2026, 11, 14, 23, 59)).calories, 400);
  });

  test('merge with new entries for the same day instead of being shadowed or double counted', () => {
    const { log: l } = recordCompletedMeal(legacy, meal('Rice', 500, '1:00 PM'), at(2026, 11, 14, 13));
    assert.deepEqual(Object.keys(l).sort(), ['2026-11-13', '2026-11-14']);
    assert.equal(dayTotals(l, '2026-11-14').calories, 900);
    assert.deepEqual(l['2026-11-14'].completedMeals, ['8:00 AM-Oats', '1:00 PM-Rice']);
    assert.deepEqual(l['2026-11-13'], legacy['2026-11-13']);
    // A meal already in the legacy record for today is not added again.
    assert.equal(recordCompletedMeal(legacy, meal('Oats', 400), at(2026, 11, 14, 9)).added, false);
    assert.equal(sumAll(l), sumAll(legacy) + 500);
  });

  test('a task counted under a legacy key on the upgrade day is not counted again under the local key', () => {
    const task = meal('Oats', 400, '8:00 AM', { countedOn: '2026-11-15' });
    const l = { '2026-11-15': { calories: 400, protein: 0, carbs: 0, fat: 0, completedMeals: ['8:00 AM-Oats'] } };
    const r = recordCompletedMeal(l, task, at(2026, 11, 14, 20));
    assert.equal(r.added, false);
  });

  test('unreadable storage reads as an empty log', () => {
    assert.deepEqual(parseNutritionLog('{bad'), {});
    assert.deepEqual(parseNutritionLog('[]'), {});
    assert.deepEqual(parseNutritionLog(null), {});
    assert.deepEqual(parseNutritionLog(JSON.stringify(legacy)), legacy);
  });
});

describe('grouping by period', () => {
  test('week is Monday-Sunday and lines up with the workout buckets', () => {
    const now = at(2026, 11, 14); // Saturday
    const buckets = buildPeriodBuckets('week', now);
    const l = log(
      [meal('Prev Sunday', 999), at(2026, 11, 8, 23, 59)],
      [meal('Mon early', 100), at(2026, 11, 9, 0, 1)],
      [meal('Wed', 200), at(2026, 11, 11, 12)],
      [meal('Sun late', 300), at(2026, 11, 15, 23, 59)],
      [meal('Next Mon', 999), at(2026, 11, 16, 0, 0)],
    );
    const totals = bucketNutritionLog(buckets, l, 'week').map((t) => t.calories);
    assert.deepEqual(totals, [100, 0, 200, 0, 0, 0, 300]);

    const workouts = bucketWorkoutHistory(buckets, [
      { completedAt: at(2026, 11, 9, 0, 1).toISOString(), caloriesBurned: 1 },
      { completedAt: at(2026, 11, 15, 23, 59).toISOString(), caloriesBurned: 1 },
    ]).map((t) => t.workouts);
    // Workouts at the same local instants fall in the same Monday and Sunday buckets.
    assert.deepEqual(workouts, [1, 0, 0, 0, 0, 0, 1]);
  });

  test('month boundary: Oct 31 23:59 and Nov 1 00:01 land in different months', () => {
    const l = log([meal('Late', 100), at(2026, 10, 31, 23, 59)], [meal('Early', 200), at(2026, 11, 1, 0, 1)]);
    const year = bucketNutritionLog(buildPeriodBuckets('year', at(2026, 11, 14)), l, 'year').map((t) => t.calories);
    assert.equal(year[9], 100);
    assert.equal(year[10], 200);
    // Month view is clipped to November, like the workout series.
    const month = bucketNutritionLog(buildPeriodBuckets('month', at(2026, 11, 14)), l, 'month').map((t) => t.calories);
    assert.equal(month[0], 200);
    assert.equal(month.reduce((a, b) => a + b, 0), 200);
  });

  test('year boundary: Dec 31 23:30 stays in Q4 of the old year, Jan 1 00:30 starts the new one', () => {
    const l = log([meal('NYE', 700), at(2026, 12, 31, 23, 30)], [meal('NYD', 300), at(2027, 1, 1, 0, 30)]);
    assert.deepEqual(Object.keys(l), ['2026-12-31', '2027-01-01']);
    const q2026 = bucketNutritionLog(buildPeriodBuckets('quarter', at(2026, 12, 1)), l, 'quarter').map((t) => t.calories);
    const q2027 = bucketNutritionLog(buildPeriodBuckets('quarter', at(2027, 1, 2)), l, 'quarter').map((t) => t.calories);
    assert.deepEqual(q2026, [0, 0, 0, 700]);
    assert.deepEqual(q2027, [300, 0, 0, 0]);
    const y2026 = bucketNutritionLog(buildPeriodBuckets('year', at(2026, 6, 1)), l, 'year').map((t) => t.calories);
    assert.equal(y2026[11], 700);
    assert.equal(y2026[0], 0);
  });

  test('quarter starts on the 1st of the month locally (old code parsed keys as UTC)', () => {
    const l = { '2026-04-01': { calories: 500 }, '2026-03-31': { calories: 50 } };
    const q = bucketNutritionLog(buildPeriodBuckets('quarter', at(2026, 5, 1)), l, 'quarter').map((t) => t.calories);
    assert.deepEqual(q, [50, 500, 0, 0]);
  });

  test('year view averages per logged day of the month', () => {
    const l = { '2026-11-01': { calories: 1000 }, '2026-11-02': { calories: 2001 } };
    const y = bucketNutritionLog(buildPeriodBuckets('year', at(2026, 11, 14)), l, 'year');
    assert.equal(y[10].calories, 1501);
    assert.equal(y[9].calories, 0);
  });

  test('totals are unchanged: every logged day is counted exactly once across the year', () => {
    const l = {
      '2026-01-01': { calories: 100, protein: 1, carbs: 2, fat: 3 },
      '2026-03-31': { calories: 200, protein: 1, carbs: 2, fat: 3 },
      '2026-04-01': { calories: 300, protein: 1, carbs: 2, fat: 3 },
      '2026-12-31': { calories: 400, protein: 1, carbs: 2, fat: 3 },
      'not-a-date': { calories: 9999 },
    };
    const q = bucketNutritionLog(buildPeriodBuckets('quarter', at(2026, 6, 1)), l, 'quarter');
    assert.equal(q.reduce((s, t) => s + t.calories, 0), 1000);
    assert.equal(q.reduce((s, t) => s + t.fat, 0), 12);
    const { totals, days } = totalsBetween(l, new Date(2026, 0, 1), new Date(2027, 0, 1));
    assert.equal(totals.calories, 1000);
    assert.equal(days, 4);
  });
});

describe('dailyTasks', () => {
  const now = at(2026, 11, 14, 20, 0);
  const today = toLocalDateKey(now);

  test('current-format record round-trips for today and resets on another day', () => {
    const tasks = [{ time: '8:00 AM', name: 'Oats', addedTime: at(2026, 11, 14, 7).toISOString() }];
    const saved = serializeDailyTasks(tasks, now);
    assert.equal(saved.date, '2026-11-14');
    assert.equal(isCurrentDailyTasks(saved, now), true);
    assert.deepEqual(restoreDailyTasks(saved, now), tasks);
    assert.deepEqual(restoreDailyTasks(saved, at(2026, 11, 15, 0, 1)), []);
    assert.equal(isCurrentDailyTasks(saved, at(2026, 11, 15, 0, 1)), false);
  });

  test('legacy record keeps only tasks added today locally and remembers where completed ones were counted', () => {
    const legacyDate = legacyUtcDateKey(now);
    const saved = {
      date: legacyDate,
      tasks: [
        { time: '8:00 AM', name: 'Oats', completed: true, addedTime: at(2026, 11, 14, 7).toISOString() },
        { time: '1:00 PM', name: 'Rice', completed: false, addedTime: at(2026, 11, 14, 12).toISOString() },
        { time: '9:00 PM', name: 'Old', completed: true, addedTime: at(2026, 11, 13, 21).toISOString() },
      ],
    };
    const restored = restoreDailyTasks(saved, now);
    assert.deepEqual(restored.map((t) => t.name), ['Oats', 'Rice']);
    assert.equal(restored[0].countedOn, legacyDate);
    assert.equal(restored[1].countedOn, undefined);
    assert.equal(isCurrentDailyTasks(saved, now), false);
  });

  test('stale legacy record is dropped', () => {
    assert.deepEqual(restoreDailyTasks({ date: '2026-11-10', tasks: [{ name: 'x' }] }, now), []);
    assert.deepEqual(restoreDailyTasks({}, now), []);
    assert.deepEqual(restoreDailyTasks(null, now), []);
  });

  test('legacy task without a timestamp is kept only when the record date is today', () => {
    assert.equal(restoreDailyTasks({ date: today, tasks: [{ name: 'x' }] }, now).length, 1);
  });
});
