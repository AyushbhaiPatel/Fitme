// Reading and writing workout history across the two stores:
//  - WorkoutSession collection: complete history, one document per session (source of truth for history).
//  - user.workoutHistory: embedded recent-entries cache kept for compatibility. Before the backfill
//    has run for a user it also holds sessions that exist nowhere else.
//
// A session's identity is its `_id`, shared by the embedded subdocument and the WorkoutSession document.
// Readers merge the collection with the embedded entries whose `_id` is not in the collection, so a
// session present in both places is counted once and an unmigrated one is still counted.

const workoutDao = require('./workout.dao');
const { entrySeconds, secondsToMinutes } = require('./workout.duration');

const RECENT_CACHE_SIZE = 50;

const toPlain = (entry) => (typeof entry?.toObject === 'function' ? entry.toObject() : { ...entry });
const idOf = (entry) => (entry?._id === undefined || entry?._id === null ? '' : String(entry._id));
const timeOf = (entry) => {
  const t = entry?.completedAt ? new Date(entry.completedAt).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

// Position of an embedded entry in user.workoutHistory (insertion order), the last tie-breaker for
// entries with the same time and no _id. Never part of a response.
const POSITION = Symbol('embeddedPosition');

// Same order as the dao sort { completedAt, _id } (ObjectId hex strings compare like their bytes).
const compareAsc = (a, b) =>
  timeOf(a) - timeOf(b) || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0) || (a[POSITION] ?? 0) - (b[POSITION] ?? 0);
const comparator = (order) => (order === 'asc' ? compareAsc : (a, b) => compareAsc(b, a));

const inRange = (entry, { from, to } = {}) => {
  const t = timeOf(entry);
  if (t === null) return false;
  if (from && t < from.getTime()) return false;
  if (to && t >= to.getTime()) return false;
  return true;
};

// Response shape of one history entry (the fields the embedded entries always had), durations in seconds.
const toHistoryEntry = (entry) => {
  const plain = toPlain(entry);
  const seconds = entrySeconds(plain);
  return {
    _id: plain._id,
    workoutId: plain.workoutId ?? null,
    completedAt: plain.completedAt,
    caloriesBurned: plain.caloriesBurned ?? 0,
    durationSeconds: seconds,
    durationMinutes: secondsToMinutes(seconds),
    workoutName: plain.workoutName,
    exercises: plain.exercises || [],
  };
};

// Embedded entries in `range` that are not in the collection yet (not migrated, or the collection
// write after a completion failed). Entries without an `_id` cannot be in the collection.
const unstoredEmbeddedEntries = async (userId, user, range) => {
  const entries = Array.from(user?.workoutHistory || [])
    .map((e, i) => Object.assign(toPlain(e), { [POSITION]: i }))
    .filter((e) => inRange(e, range));
  if (!entries.length) return [];
  const ids = entries.map(idOf).filter(Boolean);
  const stored = new Set(ids.length ? await workoutDao.findExistingSessionIds(userId, ids) : []);
  return entries.filter((e) => !idOf(e) || !stored.has(idOf(e)));
};

// Exact page [offset, offset + limit) of merge(collection, extra), where `extra` is a small in-memory
// list (at most the embedded cache). Collection positions that can land on the page lie within
// [offset - extra.length, offset + limit), so one bounded query is enough.
const mergePage = async ({ fetchStored, extra, order, offset, limit }) => {
  const cmp = comparator(order);
  const sortedExtra = [...extra].sort(cmp);
  const skip = Math.max(0, offset - sortedExtra.length);
  const take = offset + limit - skip;
  const window = take > 0 ? await fetchStored({ skip, limit: take }) : [];
  const reachedEnd = window.length < take;

  let startRank = 0;
  let pool = sortedExtra;
  if (skip > 0) {
    if (!window.length) return []; // the collection ends before `skip`, so the merged list ends before `offset`
    const before = sortedExtra.filter((e) => cmp(e, window[0]) < 0);
    startRank = skip + before.length;
    pool = sortedExtra.slice(before.length);
  }
  if (!reachedEnd && window.length) {
    const last = window[window.length - 1];
    pool = pool.filter((e) => cmp(e, last) < 0); // later extras belong after collection items we did not fetch
  }

  const merged = [...window, ...pool].sort(cmp);
  return merged.slice(offset - startRank, offset - startRank + limit);
};

// One page of the merged history, plus the merged total.
const getHistoryPage = async (userId, user, { range = {}, order = 'desc', offset = 0, limit = 20 } = {}) => {
  const [extra, storedTotal] = await Promise.all([
    unstoredEmbeddedEntries(userId, user, range),
    workoutDao.countSessions(userId, range),
  ]);
  const items = await mergePage({
    fetchStored: (opts) => workoutDao.findSessions(userId, range, { order, ...opts }),
    extra,
    order,
    offset,
    limit,
  });
  return { items, total: storedTotal + extra.length };
};

// Every session in `range` (callers keep the range small, e.g. the weekly summary's two weeks).
const getAllInRange = async (userId, user, range) => {
  const [extra, stored] = await Promise.all([
    unstoredEmbeddedEntries(userId, user, range),
    workoutDao.findSessions(userId, range, { order: 'asc' }),
  ]);
  return [...stored, ...extra].sort(compareAsc);
};

// Cache trimming and the completion write path live in workout.recorder.js.

const isDuplicateKey = (err) => err?.code === 11000 || (Array.isArray(err?.writeErrors) && err.writeErrors.length > 0 && err.writeErrors.every((e) => e?.code === 11000));

module.exports = {
  RECENT_CACHE_SIZE,
  toHistoryEntry,
  compareAsc,
  inRange,
  unstoredEmbeddedEntries,
  mergePage,
  getHistoryPage,
  getAllInRange,
  isDuplicateKey,
};
