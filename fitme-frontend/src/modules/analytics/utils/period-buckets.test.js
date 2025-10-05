import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPeriodBuckets, bucketWorkoutHistory } from './period-buckets.js';

// All dates are built in local time, the calendar the charts use.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const now = local(2026, 11, 14, 12); // Saturday 14 Nov 2026
const entry = (date, calories = 100) => ({ completedAt: date.toISOString(), caloriesBurned: calories, durationSeconds: 60 });

describe('buildPeriodBuckets', () => {
  test('week is Monday to Sunday of the current week', () => {
    const buckets = buildPeriodBuckets('week', now);
    assert.equal(buckets.length, 7);
    assert.deepEqual(buckets[0].start, local(2026, 11, 9));
    assert.deepEqual(buckets[6].start, local(2026, 11, 15));
    assert.deepEqual(buckets[6].end, local(2026, 11, 16));
  });

  test('month weeks are clipped to the month', () => {
    const buckets = buildPeriodBuckets('month', now);
    assert.equal(buckets.length, 6); // Nov 2026 starts on a Sunday and ends on a Monday
    assert.deepEqual(buckets[0].date, local(2026, 10, 26)); // Monday anchor kept for nutrition
    assert.deepEqual(buckets[0].start, local(2026, 11, 1));
    assert.deepEqual(buckets[0].end, local(2026, 11, 2));
    assert.match(buckets[0].label, / 1-1$/);
    assert.deepEqual(buckets[5].start, local(2026, 11, 30));
    assert.deepEqual(buckets[5].end, local(2026, 12, 1));
    assert.match(buckets[1].label, / 2-8$/);
  });

  test('quarter and year cover the current year', () => {
    assert.deepEqual(buildPeriodBuckets('quarter', now).map((b) => b.label), ['Q1', 'Q2', 'Q3', 'Q4']);
    const year = buildPeriodBuckets('year', now);
    assert.equal(year.length, 12);
    assert.deepEqual(year[11].end, local(2027, 1, 1));
  });

  test('unknown period yields no buckets', () => {
    assert.deepEqual(buildPeriodBuckets('decade', now), []);
  });
});

describe('bucketWorkoutHistory', () => {
  test('a late Sunday workout counts in the month view week (was dropped before)', () => {
    const buckets = buildPeriodBuckets('month', now);
    const totals = bucketWorkoutHistory(buckets, [entry(local(2026, 11, 8, 21, 30), 250)]);
    assert.deepEqual(totals[1], { workouts: 1, calories: 250 });
  });

  test('month view ignores the previous month days of the first week', () => {
    const buckets = buildPeriodBuckets('month', now);
    const totals = bucketWorkoutHistory(buckets, [entry(local(2026, 10, 30, 10))]);
    assert.equal(totals.reduce((t, b) => t + b.workouts, 0), 0);
  });

  test('week view buckets by local calendar day, including just before midnight', () => {
    const buckets = buildPeriodBuckets('week', now);
    const totals = bucketWorkoutHistory(buckets, [entry(local(2026, 11, 14, 23, 59), 80), entry(local(2026, 11, 15, 0, 1), 20)]);
    assert.deepEqual(totals[5], { workouts: 1, calories: 80 });
    assert.deepEqual(totals[6], { workouts: 1, calories: 20 });
  });

  test('quarter and year totals', () => {
    const history = [entry(local(2026, 1, 1, 0, 5)), entry(local(2026, 3, 31, 23, 50)), entry(local(2026, 4, 1, 0, 10)), entry(local(2025, 12, 31, 23, 0))];
    assert.deepEqual(bucketWorkoutHistory(buildPeriodBuckets('quarter', now), history).map((b) => b.workouts), [2, 1, 0, 0]);
    const year = bucketWorkoutHistory(buildPeriodBuckets('year', now), history);
    assert.equal(year[0].workouts, 1);
    assert.equal(year[2].workouts, 1);
    assert.equal(year[3].workouts, 1);
  });

  test('empty or malformed history yields zeros, never NaN', () => {
    const buckets = buildPeriodBuckets('week', now);
    for (const history of [undefined, null, [], [{}], [{ completedAt: 'nope', caloriesBurned: 'x' }], [{ completedAt: local(2026, 11, 10).toISOString(), caloriesBurned: 'abc' }]]) {
      const totals = bucketWorkoutHistory(buckets, history);
      assert.equal(totals.length, 7);
      for (const t of totals) {
        assert.ok(Number.isFinite(t.workouts) && Number.isFinite(t.calories));
      }
    }
  });
});
