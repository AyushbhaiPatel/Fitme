import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkoutSession,
  getDisplayedDayIndex,
  getSessionDayData,
  buildSessionCompletionPayload,
  resolveDaySelection,
  resolvePlanChange,
  isPlanDeleteBlocked,
  selectPayloadForSave,
  isDuplicateCompletion,
  classifyCompletionError,
  sessionInProgressMessage,
} from './active-session-utils.js';
import { isValidClientSessionId } from './client-session-id.js';

const plan = {
  _id: 'plan-1',
  days: [
    {
      day: 'Day 1',
      workout_type: 'Strength',
      exercises: [
        { name: 'Squats', sets: 4, calories_burned: 70 },
        { name: 'Push-ups', sets: 3, calories_burned: 45 },
      ],
    },
    {
      day: 'Day 2',
      workout_type: 'Cardio',
      exercises: [
        { name: 'Rowing', sets: 2, calories_burned: 100 },
        { name: 'Burpees', sets: 3, calories_burned: 60 },
      ],
    },
  ],
};

test('createWorkoutSession snapshots day, plan id and a fresh clientSessionId', () => {
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 1, now: 1000 });
  assert.equal(session.dayIndex, 1);
  assert.equal(session.dayName, 'Day 2');
  assert.equal(session.planId, 'plan-1');
  assert.equal(session.startTime, 1000);
  assert.equal(session.totalExercises, 2);
  assert.equal(session.dayData, plan.days[1]);
  assert.ok(isValidClientSessionId(session.clientSessionId));
});

test('every new session gets a new clientSessionId', () => {
  const a = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  const b = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  assert.notEqual(a.clientSessionId, b.clientSessionId);
});

test('day lock: no session switches freely; same day is a no-op', () => {
  assert.equal(resolveDaySelection({ session: null, selectedDay: 0, requestedDay: 1 }), 'select');
  assert.equal(resolveDaySelection({ session: null, selectedDay: 1, requestedDay: 1 }), 'noop');
});

test('day lock: during a session another day is blocked and the session day is a no-op', () => {
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  assert.equal(resolveDaySelection({ session, selectedDay: 0, requestedDay: 1 }), 'blocked');
  assert.equal(resolveDaySelection({ session, selectedDay: 0, requestedDay: 0 }), 'noop');
  // Even if selectedDay drifted, the session day stays the reference.
  assert.equal(resolveDaySelection({ session, selectedDay: 1, requestedDay: 0 }), 'noop');
  assert.equal(getDisplayedDayIndex({ session, selectedDay: 1 }), 0);
  assert.equal(getDisplayedDayIndex({ session: null, selectedDay: 1 }), 1);
});

test('plan changes are blocked only while a session exists', () => {
  assert.equal(resolvePlanChange({ session: null }), 'allow');
  assert.equal(resolvePlanChange({ session: createWorkoutSession({ workoutPlan: plan, dayIndex: 0 }) }), 'blocked');
});

test('deleting the session plan is blocked; other plans or no session are not', () => {
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  assert.equal(isPlanDeleteBlocked({ session, workoutPlan: plan, planId: 'plan-1' }), true);
  assert.equal(isPlanDeleteBlocked({ session, workoutPlan: plan, planId: 'other' }), false);
  assert.equal(isPlanDeleteBlocked({ session: null, workoutPlan: plan, planId: 'plan-1' }), false);
});

test('payload always uses the session day even if the displayed plan/day changed', () => {
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 1 });
  const otherPlan = { _id: 'plan-2', days: [{ day: 'Other', workout_type: 'Yoga', exercises: [{ name: 'Stretch', sets: 1, calories_burned: 5 }] }] };
  const { payload, summary } = buildSessionCompletionPayload({
    session,
    workoutPlan: otherPlan,
    completedExercises: new Set([0]),
    setsDone: { 1: 1 },
    durationSeconds: 600,
  });
  assert.equal(payload.workoutName, 'Day 2 - Cardio');
  assert.equal(payload.workoutId, 'plan-1');
  assert.equal(payload.clientSessionId, session.clientSessionId);
  assert.deepEqual(payload.completedExercises.map((e) => e.name), ['Rowing', 'Burpees']);
  assert.equal(payload.caloriesBurned, 100 + 20);
  assert.equal(summary.totalExercises, 2);
});

test('getSessionDayData falls back to the plan when no snapshot exists', () => {
  assert.equal(getSessionDayData({ session: { dayIndex: 1 }, workoutPlan: plan }), plan.days[1]);
  assert.equal(getSessionDayData({ session: null, workoutPlan: plan }), null);
});

test('retry after an unknown outcome resends the exact same body when nothing new was done', () => {
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  const args = { session, workoutPlan: plan, completedExercises: new Set(), setsDone: { 0: 2 } };
  const first = buildSessionCompletionPayload({ ...args, durationSeconds: 300 }).payload;
  const later = buildSessionCompletionPayload({ ...args, durationSeconds: 420 }).payload;
  assert.equal(selectPayloadForSave({ freshPayload: later, pendingAttempt: first }), first);
});

test('new progress after an unknown outcome sends the new body (same clientSessionId)', () => {
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  const first = buildSessionCompletionPayload({ session, workoutPlan: plan, setsDone: { 0: 1 }, durationSeconds: 300 }).payload;
  const more = buildSessionCompletionPayload({ session, workoutPlan: plan, setsDone: { 0: 2 }, durationSeconds: 400 }).payload;
  const chosen = selectPayloadForSave({ freshPayload: more, pendingAttempt: first });
  assert.equal(chosen, more);
  assert.equal(chosen.clientSessionId, first.clientSessionId);
});

test('a pending attempt from another session is ignored', () => {
  const a = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  const b = createWorkoutSession({ workoutPlan: plan, dayIndex: 0 });
  const old = buildSessionCompletionPayload({ session: a, workoutPlan: plan, durationSeconds: 5 }).payload;
  const fresh = buildSessionCompletionPayload({ session: b, workoutPlan: plan, durationSeconds: 5 }).payload;
  assert.equal(selectPayloadForSave({ freshPayload: fresh, pendingAttempt: old }), fresh);
  assert.equal(selectPayloadForSave({ freshPayload: fresh, pendingAttempt: null }), fresh);
});

test('duplicate response is recognised', () => {
  assert.equal(isDuplicateCompletion({ duplicate: true, message: 'ok' }), true);
  assert.equal(isDuplicateCompletion({ duplicate: false }), false);
  assert.equal(isDuplicateCompletion(undefined), false);
});

test('classifyCompletionError: 409 conflict, network/timeout/5xx unknown, other 4xx rejected', () => {
  assert.deepEqual(
    classifyCompletionError({ response: { status: 409, data: { message: 'Already saved with different data' } } }),
    { kind: 'conflict', message: 'Already saved with different data' },
  );
  assert.equal(classifyCompletionError({ response: { status: 409, data: {} } }).kind, 'conflict');
  assert.ok(classifyCompletionError({ response: { status: 409, data: {} } }).message.length > 0);
  assert.equal(classifyCompletionError({ code: 'ERR_NETWORK', message: 'Network Error' }).kind, 'unknown');
  assert.equal(classifyCompletionError({ code: 'ECONNABORTED' }).kind, 'unknown');
  assert.equal(classifyCompletionError({ response: { status: 503 } }).kind, 'unknown');
  assert.equal(classifyCompletionError({ response: { status: 400 } }).kind, 'rejected');
});

test('warning text names the session day', () => {
  assert.equal(sessionInProgressMessage('Day 2'), 'A workout is in progress for Day 2.');
});
