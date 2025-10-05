const WorkoutPlan = require('./workout.model');
const WorkoutSession = require('./workout-session.model');
const User = require('../user/user.model');
const { buildApplyUpdate, EPOCH_FIELD } = require('./workout.counters');

module.exports.createPlan = (payload) => {
  const plan = new WorkoutPlan(payload);
  return plan.save();
};

module.exports.getUserPlans = (userId, options) => WorkoutPlan.getUserPlans(userId, options);

module.exports.countUserPlans = (userId) => WorkoutPlan.countDocuments({ userId });

module.exports.findPlanByIdAndUser = (planId, userId) => WorkoutPlan.findOne({ _id: planId, userId });

module.exports.deletePlanByIdAndUser = (planId, userId) => WorkoutPlan.findOneAndDelete({ _id: planId, userId });

module.exports.findUserById = (userId) => User.findById(userId);

module.exports.saveUser = (user) => user.save();

// Atomic writes to the user's workout counters / embedded cache (see workout.counters.js and
// workout.recorder.js). Neither loads nor saves the whole document, so concurrent completions never
// overwrite each other and there is no Mongoose version conflict on the workoutHistory array.

// Applies one session's counters and appends it to the cache, only if it is not in the cache yet and the
// trim epoch still equals `expectedEpoch`. Returns the updated user document, or null if nothing matched.
module.exports.applyCompletionToUser = (userId, entry, expectedEpoch) => {
  const { filter, pipeline } = buildApplyUpdate(userId, entry, expectedEpoch);
  return User.findOneAndUpdate(filter, pipeline, { new: true, timestamps: false });
};

// Removes the given cache entries and advances the trim epoch in one atomic write.
module.exports.trimUserCache = async (userId, ids) => {
  if (!ids.length) return 0;
  const res = await User.updateOne({ _id: userId }, { $pull: { workoutHistory: { _id: { $in: ids } } }, $inc: { [EPOCH_FIELD]: 1 } });
  return res.modifiedCount || 0;
};

// Workout sessions (complete history). `range` is { from?, to? } with `from` inclusive and `to` exclusive.

const sessionFilter = (userId, { from, to } = {}) => {
  const filter = { user: userId };
  if (from || to) {
    filter.completedAt = {};
    if (from) filter.completedAt.$gte = from;
    if (to) filter.completedAt.$lt = to;
  }
  return filter;
};

// The unique { user, clientSessionId } index is what makes a keyed claim exclusive, so it is ensured once
// per process before the first claim (createIndexes only creates what is missing). Retried after a failure.
let sessionIndexes = null;
const ensureSessionIndexes = () => {
  if (!sessionIndexes) {
    sessionIndexes = WorkoutSession.createIndexes().catch((err) => {
      sessionIndexes = null;
      throw err;
    });
  }
  return sessionIndexes;
};

// The claim: inserts the session document. Throws a duplicate-key error (code 11000) if this `_id`, or
// this user's `clientSessionId`, is already stored. Never overwrites.
module.exports.createSession = async (doc) => {
  try {
    await ensureSessionIndexes();
  } catch (err) {
    // Without the unique index a keyed claim would not be exclusive: refuse rather than risk double counting.
    if (typeof doc.clientSessionId === 'string') throw err;
    console.error('WorkoutSession indexes could not be ensured:', err.message);
  }
  return new WorkoutSession(doc).save();
};

// The session a failed claim collided with: same `_id` (an earlier attempt of this request) or same key.
module.exports.findClaimedSession = (userId, id, clientSessionId) => {
  const or = [{ _id: id }];
  if (typeof clientSessionId === 'string') or.push({ clientSessionId });
  return WorkoutSession.findOne({ user: userId, $or: or }).lean();
};

module.exports.findSessionById = (userId, id) => WorkoutSession.findOne({ _id: id, user: userId }).lean();

// Sessions claimed but not confirmed counted (normally none), oldest first.
module.exports.findPendingSessions = (userId, limit = 20) =>
  WorkoutSession.find({ user: userId, countersApplied: false }).sort({ _id: 1 }).limit(limit).lean();

// pending -> applied; never the other way.
module.exports.markCountersApplied = async (id) => {
  const res = await WorkoutSession.updateOne({ _id: id, countersApplied: false }, { $set: { countersApplied: true, countersAppliedAt: new Date() } });
  return res.modifiedCount || 0;
};

// Removes a pending claim whose user no longer exists (account deleted mid-request).
module.exports.deletePendingSession = async (userId, id) => {
  const res = await WorkoutSession.deleteOne({ _id: id, user: userId, countersApplied: false });
  return res.deletedCount || 0;
};

// Sorted by completedAt then _id (a total order, so skip/limit pages are stable).
module.exports.findSessions = (userId, range, { order = 'desc', skip = 0, limit } = {}) => {
  const dir = order === 'asc' ? 1 : -1;
  const query = WorkoutSession.find(sessionFilter(userId, range)).sort({ completedAt: dir, _id: dir }).skip(skip);
  if (limit !== undefined) query.limit(limit);
  return query.lean();
};

module.exports.countSessions = (userId, range) => WorkoutSession.countDocuments(sessionFilter(userId, range));

// Which of `ids` already exist as sessions of this user (as strings).
module.exports.findExistingSessionIds = async (userId, ids) => {
  if (!ids.length) return [];
  const docs = await WorkoutSession.find({ user: userId, _id: { $in: ids } }).select('_id').lean();
  return docs.map((d) => String(d._id));
};

// Inserts the docs whose _id is not stored yet; never modifies an existing session. Returns the number inserted.
module.exports.insertSessionsIfMissing = async (docs) => {
  if (!docs.length) return 0;
  const ops = docs.map(({ _id, ...rest }) => ({
    updateOne: { filter: { _id }, update: { $setOnInsert: rest }, upsert: true, setDefaultsOnInsert: false },
  }));
  try {
    // Fail loudly (after the valid ops are written) instead of silently skipping docs that do not cast.
    const res = await WorkoutSession.bulkWrite(ops, { ordered: false, throwOnValidationError: true });
    return res.upsertedCount || 0;
  } catch (err) {
    // Two concurrent upserts of the same _id: the loser gets E11000, the session exists either way.
    const writeErrors = err?.writeErrors || err?.result?.getWriteErrors?.() || [];
    if (writeErrors.length && writeErrors.every((e) => e?.code === 11000)) return err.result?.upsertedCount ?? err.result?.nUpserted ?? 0;
    throw err;
  }
};

// Which of `ids` are stored AND counted (not pending): the only cache entries that may be trimmed.
module.exports.findCountedSessionIds = async (userId, ids) => {
  if (!ids.length) return [];
  const docs = await WorkoutSession.find({ user: userId, _id: { $in: ids }, countersApplied: { $ne: false } }).select('_id').lean();
  return docs.map((d) => String(d._id));
};

module.exports.findSessionIdsBySource = async (userId, source) => {
  const docs = await WorkoutSession.find({ user: userId, source }).select('_id').lean();
  return docs.map((d) => String(d._id));
};

module.exports.findUserIdsWithSessionSource = (source) => WorkoutSession.distinct('user', { source });

module.exports.deleteSessionsByIds = async (userId, ids, source) => {
  if (!ids.length) return 0;
  const res = await WorkoutSession.deleteMany({ user: userId, source, _id: { $in: ids } });
  return res.deletedCount || 0;
};

// Current embedded history ids, read fresh (migration undo re-checks them right before deleting).
module.exports.findEmbeddedHistoryIds = async (userId) => {
  const u = await User.findById(userId).select('workoutHistory._id').lean();
  return (u?.workoutHistory || []).map((e) => String(e._id));
};

// Account deletion: remove the user's complete session history along with the account.
module.exports.deleteSessionsForUser = async (userId) => {
  const res = await WorkoutSession.deleteMany({ user: userId });
  return res.deletedCount || 0;
};
