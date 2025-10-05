// Keeps the active workout session in sessionStorage (per tab, per user) so leaving the Workouts page,
// browser back or a refresh can offer to resume it instead of losing it. Storage is injected for tests.
import { isValidClientSessionId } from './client-session-id.js';

export const ACTIVE_SESSION_VERSION = 1;
export const ACTIVE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const getActiveSessionStorageKey = (userId) => `fitme:${userId || 'guest'}:active_workout_session`;

const getDefaultStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** Record written to storage. `pendingAttempt` is the body of a save whose outcome is unknown, if any. */
export const serializeActiveSession = ({ session, workoutPlan, setsDone = {}, completedExercises = [], pendingAttempt = null, now = Date.now() }) => ({
  version: ACTIVE_SESSION_VERSION,
  savedAt: now,
  session,
  plan: workoutPlan || null,
  setsDone: { ...setsDone },
  completedExercises: [...new Set(completedExercises)],
  pendingAttempt: pendingAttempt || null,
});

const sanitizeSetsDone = (raw) => {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    const count = Math.floor(Number(value));
    if (Number.isInteger(index) && index >= 0 && Number.isFinite(count) && count > 0) out[index] = count;
  }
  return out;
};

/** Validated record, or null when missing, malformed, from another version, or older than the TTL. */
export const parseActiveSession = (raw, { now = Date.now(), ttlMs = ACTIVE_SESSION_TTL_MS } = {}) => {
  if (typeof raw !== 'string' || !raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(record) || record.version !== ACTIVE_SESSION_VERSION) return null;

  const { session, plan } = record;
  if (!isPlainObject(session) || !isValidClientSessionId(session.clientSessionId)) return null;
  const startTime = Number(session.startTime);
  const savedAt = Number(record.savedAt);
  if (!Number.isFinite(startTime) || !Number.isFinite(savedAt) || startTime > now + 60_000) return null;
  if (now - savedAt > ttlMs) return null;

  if (!isPlainObject(plan) || !Array.isArray(plan.days)) return null;
  const dayIndex = Number(session.dayIndex);
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.days.length) return null;

  const dayData = isPlainObject(session.dayData) ? session.dayData : plan.days[dayIndex];
  const exerciseCount = Array.isArray(dayData?.exercises) ? dayData.exercises.length : 0;
  const completedExercises = Array.isArray(record.completedExercises)
    ? record.completedExercises.filter((i) => Number.isInteger(i) && i >= 0 && i < exerciseCount)
    : [];

  return {
    savedAt,
    session: { ...session, dayIndex, startTime, dayData },
    plan,
    setsDone: sanitizeSetsDone(record.setsDone),
    completedExercises,
    pendingAttempt: isPlainObject(record.pendingAttempt) && record.pendingAttempt.clientSessionId === session.clientSessionId
      ? record.pendingAttempt
      : null,
  };
};

/** Best-effort write; storage errors (quota, private mode) are ignored. */
export const saveActiveSession = (key, record, storage = getDefaultStorage()) => {
  try {
    storage?.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
};

/** Reads and validates; an invalid or expired record is removed. */
export const loadActiveSession = (key, { storage = getDefaultStorage(), now = Date.now(), ttlMs } = {}) => {
  let raw = null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  const record = parseActiveSession(raw, { now, ttlMs });
  if (!record) clearActiveSession(key, storage);
  return record;
};

export const clearActiveSession = (key, storage = getDefaultStorage()) => {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
};
