// Recording a completed workout: idempotent and safe under concurrency, on a standalone mongod
// (no transactions needed). Three single-document atomic steps:
//
//  1. CLAIM   insert the WorkoutSession document with `countersApplied: false`. The unique index on
//             { user, clientSessionId } decides, at the database, whether a keyed completion is new.
//             Keyless completions always get a fresh claim (never deduplicated).
//  2. APPLY   one conditional pipeline update of the user document (workout.counters.js): increments the
//             counters, carries a legacy minutes-only total over to seconds, recomputes the derived minute
//             fields and appends the session to the embedded cache. Condition: the session is not in the
//             cache yet AND `workoutCacheTrimEpoch` equals the value read before the session's state was read.
//  3. MARK    `countersApplied: false -> true` on the session document.
//
// Cache trim: an embedded entry is dropped (atomic $pull, which also increments the epoch) only when it
// is beyond the newest RECENT_CACHE_SIZE, stored in the collection, and not pending.
//
// Why APPLY happens at most once per session: an entry is in the cache iff its counters were applied (2 is
// one atomic write), so a second APPLY can only match after the entry was trimmed. Trimming needs the
// session marked (3) and increments the epoch. Every actor reads the epoch BEFORE it looks at the session's
// state (or, for the claimer, before claiming it), so an actor whose state is older than the trim also holds
// an older epoch and its APPLY does not match; an actor that read the epoch after the trim sees the session
// marked and does not apply. No timing assumptions.
//
// Why it is applied at least once: a claimed session is either confirmed (marked) or stays pending; pending
// sessions are applied by any later request that meets them: a retry with the same key, the user's next
// completion, or the next statistics / history / weekly-summary read (reconcilePending).
//
// Failure model (request-level):
//  - failure before or during CLAIM: nothing is stored; the request errors; a retry is a fresh completion.
//    (If the insert reached the database but the acknowledgement was lost, the in-request retry finds its own
//    `_id` and continues; if the request gave up, the session is pending and is reconciled as below.)
//  - failure after CLAIM, before APPLY succeeded (DB error, process crash): the request errors (no success is
//    returned for counters that were not applied); the session stays pending. A retry with the same key finds
//    it and applies it exactly once; otherwise the next completion/read for that user applies it.
//  - failure after APPLY, before MARK: the session is counted and cached; the request still succeeds. The
//    next actor that meets the pending session sees it in the cache, does not re-apply, and marks it.
//  - APPLY conflicts (epoch changed by a concurrent trim) are retried with fresh reads, bounded.

const crypto = require('crypto');
const mongoose = require('mongoose');
const workoutDao = require('./workout.dao');
const { epochOf } = require('./workout.counters');
const { secondsToMinutes, entrySeconds } = require('./workout.duration');
const { RECENT_CACHE_SIZE, isDuplicateKey } = require('./workout.history');

const CLIENT_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const CLAIM_ATTEMPTS = 3;
const APPLY_ATTEMPTS = 8;

const MESSAGES = {
  invalidBodyKey: 'clientSessionId must be 8-64 characters: letters, digits, "-" or "_"',
  invalidHeaderKey: 'Idempotency-Key header must be 8-64 characters: letters, digits, "-" or "_"',
  keyMismatch: 'clientSessionId and Idempotency-Key header must match when both are sent',
  conflict: 'This clientSessionId was already used for a different workout',
};

// { key } (string or null when none was sent) or { error }. The body value wins; both must agree if both are sent.
const resolveClientSessionId = (bodyValue, headerValue) => {
  const present = (v) => v !== undefined && v !== null;
  const valid = (v) => typeof v === 'string' && CLIENT_SESSION_ID_PATTERN.test(v);
  if (present(bodyValue) && !valid(bodyValue)) return { error: MESSAGES.invalidBodyKey };
  if (present(headerValue) && !valid(headerValue)) return { error: MESSAGES.invalidHeaderKey };
  if (present(bodyValue) && present(headerValue) && bodyValue !== headerValue) return { error: MESSAGES.keyMismatch };
  return { key: present(bodyValue) ? bodyValue : present(headerValue) ? headerValue : null };
};

const intOrNull = (v) => (Number.isInteger(v) ? v : null);

// What makes two completions "the same workout" for a reused key. Computed from the normalised request and
// from the stored session the same way, so nothing extra is stored. completedAt is deliberately excluded.
const fingerprint = (s) => crypto.createHash('sha256').update(JSON.stringify({
  durationSeconds: entrySeconds(s),
  caloriesBurned: Math.round(Number(s.caloriesBurned) || 0),
  workoutId: s.workoutId ? String(s.workoutId) : null,
  workoutName: s.workoutName ?? null,
  exercises: (s.exercises || []).map((e) => [String(e.name), e.completed === true, Number(e.caloriesBurned) || 0, intOrNull(e.completedSets), intOrNull(e.totalSets)]),
})).digest('hex');

// Embedded cache entry for a session document (same `_id`).
const cacheEntryFromSession = (s) => {
  const seconds = entrySeconds(s);
  return {
    _id: s._id,
    workoutId: s.workoutId ?? null,
    completedAt: s.completedAt,
    caloriesBurned: Number(s.caloriesBurned) || 0,
    durationSeconds: seconds,
    durationMinutes: secondsToMinutes(seconds),
    workoutName: s.workoutName,
    exercises: (s.exercises || []).map((e) => {
      const item = { name: e.name, completed: e.completed, caloriesBurned: e.caloriesBurned };
      if (e.completedSets !== undefined && e.completedSets !== null) item.completedSets = e.completedSets;
      if (e.totalSets !== undefined && e.totalSets !== null) item.totalSets = e.totalSets;
      return item;
    }),
  };
};

const sameId = (a, b) => String(a) === String(b);
const inCache = (user, id) => Array.from(user?.workoutHistory || []).some((e) => e?._id && sameId(e._id, id));
const backoff = (attempt) => new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(5 * 2 ** attempt, 100)));

// A user document together with the trim epoch it had WHEN IT WAS READ (documents may be live objects).
const snapshot = (user) => (user ? { user, epoch: epochOf(user) } : null);
const loadUser = async (userId) => snapshot(await workoutDao.findUserById(userId));

const markApplied = async (id) => {
  try {
    await workoutDao.markCountersApplied(id);
  } catch (err) {
    // Counted and cached already; the next actor that meets the pending session marks it.
    console.error(`Workout session ${id}: counters applied but not marked yet:`, err.message);
  }
};

// Makes sure `session`'s counters are applied exactly once. `known` = { user, epoch } read BEFORE `session`
// was read (or claimed); without it everything is read fresh. Returns the newest user snapshot that
// includes the session's counters, or null if the user no longer exists. Throws if it cannot confirm.
const ensureApplied = async (userId, session, known) => {
  const entry = cacheEntryFromSession(session);
  let current = known || null;
  let state = known ? session : null;
  let lastError = null;
  for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt++) {
    try {
      if (!current) {
        current = await loadUser(userId); // epoch first ...
        if (!current) return null;
        state = null;
      }
      if (inCache(current.user, entry._id)) {
        await markApplied(entry._id);
        return current;
      }
      if (!state) state = await workoutDao.findSessionById(userId, entry._id); // ... then the session's state
      if (!state) return current; // deleted (account deletion): nothing to count
      if (state.countersApplied !== false) return loadUser(userId); // applied by someone else; fresh totals
      const updated = await workoutDao.applyCompletionToUser(userId, entry, current.epoch);
      if (updated) {
        await markApplied(entry._id);
        return snapshot(updated);
      }
      // Not matched: in the cache already, user gone, or a trim moved the epoch. Re-read and decide again.
    } catch (err) {
      lastError = err;
    }
    current = null;
    state = null;
    await backoff(attempt);
  }
  throw lastError || new Error(`Workout session ${entry._id}: counters could not be applied (concurrent updates kept conflicting)`);
};

// Applies the user's pending sessions (normally none). `known` must have been read before this call.
const reconcilePending = async (userId, known, { excludeId } = {}) => {
  let latest = known;
  const pending = await workoutDao.findPendingSessions(userId);
  for (const session of pending) {
    if (excludeId && sameId(session._id, excludeId)) continue;
    try {
      const result = await ensureApplied(userId, session, known);
      if (result) latest = result;
    } catch (err) {
      console.error(`Workout session ${session._id}: reconciliation failed, will retry on the next request:`, err.message);
    }
  }
  return latest;
};

// Drops cache entries beyond the newest RECENT_CACHE_SIZE that are stored in the collection and counted.
// Entries missing from the collection (unmigrated legacy) or still pending are never dropped. Best effort.
const trimCache = async (userId, user) => {
  try {
    const history = Array.from(user?.workoutHistory || []);
    if (history.length <= RECENT_CACHE_SIZE) return 0;
    const older = history.slice(0, history.length - RECENT_CACHE_SIZE).map((e) => e?._id).filter(Boolean);
    if (!older.length) return 0;
    const counted = await workoutDao.findCountedSessionIds(userId, older);
    if (!counted.length) return 0;
    const wanted = new Set(counted.map(String));
    return await workoutDao.trimUserCache(userId, older.filter((id) => wanted.has(String(id))));
  } catch (err) {
    console.error('Workout history cache trim skipped:', err.message);
    return 0;
  }
};

// CLAIM with bounded retries. { claimed: true } or { claimed: false, existing }.
const claim = async (userId, doc) => {
  let lastError = null;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    try {
      await workoutDao.createSession(doc);
      return { claimed: true };
    } catch (err) {
      if (isDuplicateKey(err)) {
        const existing = await workoutDao.findClaimedSession(userId, doc._id, doc.clientSessionId);
        if (existing && sameId(existing._id, doc._id)) return { claimed: true }; // an earlier attempt got through
        if (existing) return { claimed: false, existing };
      }
      lastError = err;
    }
    if (attempt < CLAIM_ATTEMPTS - 1) await backoff(attempt);
  }
  throw lastError;
};

// Reconcile other pending sessions, then trim. Never fails the request.
const finish = async (userId, latest, ownId) => {
  let result = latest;
  try {
    result = await reconcilePending(userId, latest, { excludeId: ownId });
  } catch (err) {
    console.error('Workout reconciliation skipped:', err.message);
  }
  await trimCache(userId, result.user);
  return result;
};

// payload: normalised { durationSeconds, caloriesBurned (rounded), workoutId|null, workoutName, exercises }.
// Returns { status: 'recorded' | 'duplicate' | 'conflict' | 'no-user', session?, user? }.
const recordCompletion = async (userId, payload, clientSessionId = null) => {
  const known = await loadUser(userId); // read before the claim: its epoch fences our APPLY
  if (!known) return { status: 'no-user' };

  const now = new Date();
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    user: userId,
    completedAt: now,
    durationSeconds: payload.durationSeconds,
    caloriesBurned: payload.caloriesBurned,
    workoutId: payload.workoutId || null,
    workoutName: payload.workoutName,
    exercises: payload.exercises,
    source: 'completion',
    recordedAt: now,
    countersApplied: false,
  };
  if (clientSessionId) doc.clientSessionId = clientSessionId;

  const claimed = await claim(userId, doc);
  if (!claimed.claimed) {
    const { existing } = claimed;
    if (fingerprint(existing) !== fingerprint(doc)) return { status: 'conflict', session: existing };
    // `known` was read before `existing`, so it is a valid fence for it.
    const latest = await ensureApplied(userId, existing, known);
    if (!latest) return { status: 'no-user' };
    return { status: 'duplicate', session: existing, user: (await finish(userId, latest, existing._id)).user };
  }

  const latest = await ensureApplied(userId, doc, known);
  if (!latest) {
    await workoutDao.deletePendingSession(userId, doc._id).catch(() => {});
    return { status: 'no-user' };
  }
  return { status: 'recorded', session: doc, user: (await finish(userId, latest, doc._id)).user };
};

// For readers: applies pending sessions first so totals and history agree. Returns the user to read from.
const loadUserForRead = async (userId) => {
  const known = await loadUser(userId);
  if (!known) return null;
  try {
    return (await reconcilePending(userId, known)).user;
  } catch (err) {
    console.error('Workout reconciliation on read skipped:', err.message);
    return known.user;
  }
};

module.exports = {
  CLIENT_SESSION_ID_PATTERN,
  MESSAGES,
  APPLY_ATTEMPTS,
  resolveClientSessionId,
  fingerprint,
  cacheEntryFromSession,
  ensureApplied,
  reconcilePending,
  trimCache,
  recordCompletion,
  loadUserForRead,
};
