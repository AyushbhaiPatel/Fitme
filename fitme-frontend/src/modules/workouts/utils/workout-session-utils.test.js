import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTotalSets,
  getCompletedSets,
  proportionalCalories,
  buildSessionSummary,
  buildCompletionPayload,
} from './workout-session-utils.js';

const day = {
  day: 'Monday',
  workout_type: 'Strength',
  exercises: [
    { name: 'Squats', sets: 4, calories_burned: 70 },
    { name: 'Push-ups', sets: 3, calories_burned: 45 },
    { name: 'Plank', calories_burned: 20 }, // no sets
  ],
};

test('getTotalSets falls back to 1 for missing or invalid sets', () => {
  assert.equal(getTotalSets({ sets: 4 }), 4);
  assert.equal(getTotalSets({ sets: '3' }), 3);
  assert.equal(getTotalSets({}), 1);
  assert.equal(getTotalSets({ sets: 0 }), 1);
  assert.equal(getTotalSets(undefined), 1);
});

test('getCompletedSets never reports a partial exercise as fully done', () => {
  assert.equal(getCompletedSets({ sets: 4 }, { setsDone: 2 }), 2);
  assert.equal(getCompletedSets({ sets: 4 }, { setsDone: 9 }), 3);
  assert.equal(getCompletedSets({ sets: 4 }, { setsDone: -1 }), 0);
  assert.equal(getCompletedSets({ sets: 4 }, { isFullyCompleted: true, setsDone: 1 }), 4);
  assert.equal(getCompletedSets({}, { setsDone: 1 }), 0);
});

test('proportionalCalories scales by completed sets', () => {
  assert.equal(proportionalCalories(70, 2, 4), 35);
  assert.equal(proportionalCalories(70, 1, 3), 23);
  assert.equal(proportionalCalories(70, 4, 4), 70);
  assert.equal(proportionalCalories(70, 0, 4), 0);
  assert.equal(proportionalCalories(undefined, 2, 4), 0);
});

test('summary of a partial session: proportional calories, partial not marked complete', () => {
  const summary = buildSessionSummary({
    exercises: day.exercises,
    completedExercises: new Set([1]),
    setsDone: { 0: 2 },
  });
  assert.equal(summary.isFullyComplete, false);
  assert.equal(summary.hasProgress, true);
  assert.equal(summary.fullyCompletedCount, 1);
  assert.equal(summary.partialCount, 1);
  assert.equal(summary.completedSets, 5);
  assert.equal(summary.totalSets, 8);
  assert.equal(summary.totalCalories, 35 + 45);
  assert.deepEqual(
    summary.exercises.map(({ name, completedSets, fullyCompleted, caloriesBurned }) => ({ name, completedSets, fullyCompleted, caloriesBurned })),
    [
      { name: 'Squats', completedSets: 2, fullyCompleted: false, caloriesBurned: 35 },
      { name: 'Push-ups', completedSets: 3, fullyCompleted: true, caloriesBurned: 45 },
    ],
  );
});

test('summary of a fully completed session keeps full calorie values', () => {
  const summary = buildSessionSummary({ exercises: day.exercises, completedExercises: new Set([2, 0, 1]) });
  assert.equal(summary.isFullyComplete, true);
  assert.equal(summary.totalCalories, 135);
  assert.equal(summary.partialCount, 0);
});

test('summary with zero completed sets is time-only', () => {
  const summary = buildSessionSummary({ exercises: day.exercises });
  assert.equal(summary.hasProgress, false);
  assert.equal(summary.isFullyComplete, false);
  assert.equal(summary.totalCalories, 0);
  assert.deepEqual(summary.exercises, []);
});

test('empty day is never fully complete', () => {
  assert.equal(buildSessionSummary({ exercises: [] }).isFullyComplete, false);
});

test('buildCompletionPayload produces the backend shape', () => {
  const summary = buildSessionSummary({ exercises: day.exercises, completedExercises: [1], setsDone: { 0: 2 } });
  const payload = buildCompletionPayload({ workoutId: 'abc', dayData: day, summary, durationSeconds: 754.9 });
  assert.deepEqual(payload, {
    workoutId: 'abc',
    caloriesBurned: 80,
    durationSeconds: 754,
    completedExercises: [
      { name: 'Squats', completed: false, caloriesBurned: 35, completedSets: 2, totalSets: 4 },
      { name: 'Push-ups', completed: true, caloriesBurned: 45, completedSets: 3, totalSets: 3 },
    ],
    workoutName: 'Monday - Strength',
  });
});

test('buildCompletionPayload for a time-only save', () => {
  const summary = buildSessionSummary({ exercises: day.exercises });
  const payload = buildCompletionPayload({ dayData: undefined, summary, durationSeconds: 42 });
  assert.equal(payload.workoutId, null);
  assert.equal(payload.caloriesBurned, 0);
  assert.equal(payload.durationSeconds, 42);
  assert.deepEqual(payload.completedExercises, []);
  assert.equal(payload.workoutName, 'Workout - Custom');
});

test('buildCompletionPayload sends clientSessionId when given', () => {
  const summary = buildSessionSummary({ exercises: day.exercises });
  const payload = buildCompletionPayload({ clientSessionId: 'sess_abc12345', dayData: day, summary, durationSeconds: 10 });
  assert.equal(payload.clientSessionId, 'sess_abc12345');
  assert.equal('clientSessionId' in buildCompletionPayload({ dayData: day, summary, durationSeconds: 10 }), false);
});
