import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_SESSION_TTL_MS,
  getActiveSessionStorageKey,
  serializeActiveSession,
  parseActiveSession,
  saveActiveSession,
  loadActiveSession,
  clearActiveSession,
} from './session-persistence.js';
import { createWorkoutSession } from './active-session-utils.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
};

const plan = {
  _id: 'plan-1',
  days: [
    { day: 'Day 1', workout_type: 'Strength', exercises: [{ name: 'Squats', sets: 4 }, { name: 'Push-ups', sets: 3 }] },
    { day: 'Day 2', workout_type: 'Cardio', exercises: [{ name: 'Rowing', sets: 2 }] },
  ],
};

const T0 = 1_700_000_000_000;

test('storage key is per user', () => {
  assert.equal(getActiveSessionStorageKey('u1'), 'fitme:u1:active_workout_session');
  assert.equal(getActiveSessionStorageKey(undefined), 'fitme:guest:active_workout_session');
});

test('round trip keeps plan, day, start time, progress and clientSessionId', () => {
  const storage = memoryStorage();
  const key = getActiveSessionStorageKey('u1');
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 1, now: T0 });
  const pendingAttempt = { clientSessionId: session.clientSessionId, durationSeconds: 60 };
  saveActiveSession(key, serializeActiveSession({
    session, workoutPlan: plan, setsDone: { 0: 1 }, completedExercises: [0], pendingAttempt, now: T0 + 1000,
  }), storage);

  const record = loadActiveSession(key, { storage, now: T0 + 5000 });
  assert.equal(record.session.clientSessionId, session.clientSessionId);
  assert.equal(record.session.dayIndex, 1);
  assert.equal(record.session.startTime, T0);
  assert.deepEqual(record.session.dayData, plan.days[1]);
  assert.deepEqual(record.plan, plan);
  assert.deepEqual(record.setsDone, { 0: 1 });
  assert.deepEqual(record.completedExercises, [0]);
  assert.deepEqual(record.pendingAttempt, pendingAttempt);
});

test('another user does not see the session', () => {
  const storage = memoryStorage();
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 0, now: T0 });
  saveActiveSession(getActiveSessionStorageKey('u1'), serializeActiveSession({ session, workoutPlan: plan, now: T0 }), storage);
  assert.equal(loadActiveSession(getActiveSessionStorageKey('u2'), { storage, now: T0 }), null);
});

test('expired sessions (older than 12h since last update) are dropped and removed', () => {
  const storage = memoryStorage();
  const key = getActiveSessionStorageKey('u1');
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 0, now: T0 });
  saveActiveSession(key, serializeActiveSession({ session, workoutPlan: plan, now: T0 }), storage);
  assert.ok(loadActiveSession(key, { storage, now: T0 + ACTIVE_SESSION_TTL_MS }));
  assert.equal(loadActiveSession(key, { storage, now: T0 + ACTIVE_SESSION_TTL_MS + 1 }), null);
  assert.equal(storage.size(), 0);
});

test('malformed or invalid records are rejected', () => {
  const now = T0;
  const valid = serializeActiveSession({ session: createWorkoutSession({ workoutPlan: plan, dayIndex: 0, now }), workoutPlan: plan, now });
  assert.ok(parseActiveSession(JSON.stringify(valid), { now }));
  assert.equal(parseActiveSession('not json', { now }), null);
  assert.equal(parseActiveSession(JSON.stringify({ ...valid, version: 99 }), { now }), null);
  assert.equal(parseActiveSession(JSON.stringify({ ...valid, plan: null }), { now }), null);
  assert.equal(parseActiveSession(JSON.stringify({ ...valid, session: { ...valid.session, clientSessionId: 'bad id' } }), { now }), null);
  assert.equal(parseActiveSession(JSON.stringify({ ...valid, session: { ...valid.session, dayIndex: 5 } }), { now }), null);
  assert.equal(parseActiveSession(JSON.stringify({ ...valid, session: { ...valid.session, startTime: now + 3_600_000 } }), { now }), null);
});

test('progress is sanitised and a pending attempt for another session is dropped', () => {
  const now = T0;
  const session = createWorkoutSession({ workoutPlan: plan, dayIndex: 0, now });
  const raw = JSON.stringify({
    ...serializeActiveSession({ session, workoutPlan: plan, now }),
    setsDone: { 0: 2, 1: -1, x: 3, 2: 'abc' },
    completedExercises: [1, 7, -1, 'a'],
    pendingAttempt: { clientSessionId: 'someone-else-123' },
  });
  const record = parseActiveSession(raw, { now });
  assert.deepEqual(record.setsDone, { 0: 2 });
  assert.deepEqual(record.completedExercises, [1]);
  assert.equal(record.pendingAttempt, null);
});

test('clear removes the record; storage failures are swallowed', () => {
  const storage = memoryStorage();
  const key = getActiveSessionStorageKey('u1');
  saveActiveSession(key, { a: 1 }, storage);
  clearActiveSession(key, storage);
  assert.equal(storage.getItem(key), null);

  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(saveActiveSession(key, { a: 1 }, broken), false);
  assert.equal(loadActiveSession(key, { storage: broken }), null);
  assert.doesNotThrow(() => clearActiveSession(key, broken));
});
