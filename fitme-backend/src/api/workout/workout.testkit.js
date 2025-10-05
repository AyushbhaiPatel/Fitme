// Test helper (not a test file): an in-memory stand-in for the workout dao, installed with node:test
// `mock.method` so nothing touches the database. Mirrors the dao contract:
//  - sessions: range is [from, to), sort is { completedAt, _id }, inserts never overwrite; createSession
//    enforces the unique `_id` and the unique partial { user, clientSessionId } index (string keys only)
//    with E11000 errors; markCountersApplied only moves false -> true.
//  - user: applyCompletionToUser / trimUserCache are single atomic steps on the user object returned by the
//    (test-mocked) workoutDao.findUserById, with the same conditions as the real filter (not in cache, epoch
//    unchanged) and the same arithmetic (nextCounters, the reference for the real update pipeline).
// Every operation yields to the event loop before and after its atomic step (a seeded random number of
// turns), so `Promise.all` over service calls really interleaves. `fail(op, { times, error, after })`
// injects failures: before the step (nothing happens) or, with `after: true`, after it (the write happened
// but the caller sees an error, like a lost acknowledgement or a crash right after the write).

const { mock } = require('node:test');
const workoutDao = require('./workout.dao');
const { nextCounters, epochOf, EPOCH_FIELD } = require('./workout.counters');

// Shallow copies: structuredClone would strip ObjectId instances.
const clone = (d) => ({ ...d, exercises: Array.isArray(d.exercises) ? d.exercises.map((e) => ({ ...e })) : d.exercises });
const idOf = (d) => String(d._id);
const timeOf = (d) => new Date(d.completedAt).getTime();
const cmpAsc = (a, b) => timeOf(a) - timeOf(b) || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0);
const dupError = (what) => Object.assign(new Error(`E11000 duplicate key error (${what})`), { code: 11000 });

// Small deterministic PRNG (mulberry32).
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const installSessionStore = ({ sessions = [], failCreate = 0, failCreateWith, seed = 1, maxYields = 3 } = {}) => {
  const store = sessions.map(clone);
  const rand = prng(seed);
  const failures = new Map();
  const state = { store, createFailuresLeft: failCreate, failures };

  const tick = async () => {
    const n = 1 + Math.floor(rand() * maxYields);
    for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  state.fail = (op, { times = 1, error, after = false } = {}) => {
    failures.set(op, { left: times, error: error || new Error(`${op} failed (injected)`), after });
  };
  const failing = (op, after) => {
    const f = failures.get(op);
    if (!f || f.left <= 0 || f.after !== after) return null;
    f.left -= 1;
    return f.error;
  };

  // Wraps an atomic step: yield, maybe fail, run synchronously, yield, maybe fail after the fact.
  const atomic = (op, body) => async (...args) => {
    await tick();
    const before = failing(op, false);
    if (before) throw before;
    const result = body(...args);
    await tick();
    const after = failing(op, true);
    if (after) throw after;
    return result;
  };
  const install = (op, body) => mock.method(workoutDao, op, atomic(op, body));

  const inRange = (d, { from, to } = {}) => (!from || timeOf(d) >= from.getTime()) && (!to || timeOf(d) < to.getTime());
  const forUser = (userId, range) => store.filter((d) => String(d.user) === String(userId) && inRange(d, range));
  const byId = (id) => store.find((d) => idOf(d) === String(id));

  state.create = install('createSession', (doc) => {
    if (state.createFailuresLeft > 0) {
      state.createFailuresLeft -= 1;
      throw failCreateWith || new Error('session store unavailable');
    }
    if (byId(doc._id)) throw dupError('_id');
    if (typeof doc.clientSessionId === 'string' && store.some((d) => String(d.user) === String(doc.user) && d.clientSessionId === doc.clientSessionId)) {
      throw dupError('user_clientSessionId_unique');
    }
    store.push(clone(doc));
    return doc;
  });
  state.findClaimed = install('findClaimedSession', (userId, id, key) => {
    const found = forUser(userId).find((d) => idOf(d) === String(id) || (typeof key === 'string' && d.clientSessionId === key));
    return found ? clone(found) : null;
  });
  state.findById = install('findSessionById', (userId, id) => {
    const found = forUser(userId).find((d) => idOf(d) === String(id));
    return found ? clone(found) : null;
  });
  state.pending = install('findPendingSessions', (userId, limit = 20) =>
    forUser(userId).filter((d) => d.countersApplied === false).sort((a, b) => (idOf(a) < idOf(b) ? -1 : 1)).slice(0, limit).map(clone));
  state.mark = install('markCountersApplied', (id) => {
    const d = byId(id);
    if (!d || d.countersApplied !== false) return 0;
    d.countersApplied = true;
    d.countersAppliedAt = new Date();
    return 1;
  });
  state.deletePending = install('deletePendingSession', (userId, id) => {
    const i = store.findIndex((d) => idOf(d) === String(id) && String(d.user) === String(userId) && d.countersApplied === false);
    if (i < 0) return 0;
    store.splice(i, 1);
    return 1;
  });
  state.counted = install('findCountedSessionIds', (userId, ids) => {
    const wanted = new Set(ids.map(String));
    return forUser(userId).filter((d) => wanted.has(idOf(d)) && d.countersApplied !== false).map(idOf);
  });

  state.find = install('findSessions', (userId, range, { order = 'desc', skip = 0, limit } = {}) => {
    const sorted = forUser(userId, range).sort(order === 'asc' ? cmpAsc : (a, b) => cmpAsc(b, a));
    return sorted.slice(skip, limit === undefined ? undefined : skip + limit).map(clone);
  });
  state.count = install('countSessions', (userId, range) => forUser(userId, range).length);
  state.existing = install('findExistingSessionIds', (userId, ids) => {
    const wanted = new Set(ids.map(String));
    return forUser(userId).map(idOf).filter((id) => wanted.has(id));
  });
  state.insertMissing = install('insertSessionsIfMissing', (docs) => {
    let n = 0;
    for (const doc of docs) {
      if (byId(doc._id)) continue;
      store.push(clone(doc));
      n += 1;
    }
    return n;
  });
  state.bySource = install('findSessionIdsBySource', (userId, source) => forUser(userId).filter((d) => d.source === source).map(idOf));
  state.remove = install('deleteSessionsByIds', (userId, ids, source) => {
    const wanted = new Set(ids.map(String));
    let n = 0;
    for (let i = store.length - 1; i >= 0; i--) {
      const d = store[i];
      if (String(d.user) === String(userId) && d.source === source && wanted.has(idOf(d))) { store.splice(i, 1); n += 1; }
    }
    return n;
  });

  // User document operations. The user object comes from the test's findUserById mock (resolved before
  // the atomic step, like a server-side lookup by _id).
  const userOp = (op, body) => {
    const step = atomic(op, body);
    return mock.method(workoutDao, op, async (userId, ...rest) => step(await workoutDao.findUserById(userId), ...rest));
  };
  state.applyUser = userOp('applyCompletionToUser', (user, entry, expectedEpoch) => {
    if (!user) return null;
    if (epochOf(user) !== expectedEpoch) return null;
    if (!user.workoutHistory) user.workoutHistory = [];
    if (Array.from(user.workoutHistory).some((e) => e?._id && String(e._id) === idOf(entry))) return null;
    Object.assign(user, nextCounters(user, entry));
    user.workoutHistory.push(clone(entry));
    return user;
  });
  state.trimUser = userOp('trimUserCache', (user, ids) => {
    if (!user || !ids.length) return 0;
    const wanted = new Set(ids.map(String));
    const history = user.workoutHistory || [];
    let removed = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]?._id && wanted.has(String(history[i]._id))) { history.splice(i, 1); removed += 1; }
    }
    user[EPOCH_FIELD] = epochOf(user) + 1;
    return removed ? 1 : 0;
  });

  return state;
};

module.exports = { installSessionStore };
