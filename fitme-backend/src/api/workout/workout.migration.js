// Backfill of embedded `user.workoutHistory` entries into the WorkoutSession collection.
// Run only through scripts/migrate-workout-history.js (never automatically). Guarantees:
//  - dry run unless `apply` is true;
//  - idempotent: a session keeps the embedded entry's `_id`, so already-copied entries are skipped and
//    the insert itself never overwrites an existing session;
//  - non-destructive: reads users only, never modifies embedded entries or user totals;
//  - copies fields as they are: a legacy minute-only entry stays minute-only (no seconds are estimated);
//  - reversible: copies are tagged `source: 'migration'`; `undoUserMigration` deletes them again.

const workoutDao = require('./workout.dao');

const COPIED_FIELDS = ['completedAt', 'durationSeconds', 'durationMinutes', 'caloriesBurned', 'workoutId', 'workoutName', 'exercises'];

const toPlain = (entry) => (typeof entry?.toObject === 'function' ? entry.toObject() : entry);
const hasValidDate = (entry) => !!entry?.completedAt && !Number.isNaN(new Date(entry.completedAt).getTime());

// Session document for one embedded entry: same _id, present fields copied unchanged, nothing derived.
const buildMigrationDoc = (userId, entry, now) => {
  const doc = { _id: entry._id, user: userId };
  for (const field of COPIED_FIELDS) {
    if (entry[field] !== undefined) doc[field] = entry[field];
  }
  doc.source = 'migration';
  doc.recordedAt = now;
  return doc;
};

// `user` needs `_id` and `workoutHistory` (a lean document is enough).
const migrateUserHistory = async (user, { apply = false, dao = workoutDao, now = new Date() } = {}) => {
  const userId = user._id;
  const entries = Array.from(user.workoutHistory || []).map(toPlain);
  const report = { userId: String(userId), embedded: entries.length, skippedNoId: 0, skippedNoDate: 0, alreadyStored: 0, toCopy: 0, copied: 0 };

  const candidates = [];
  for (const entry of entries) {
    if (entry?._id === undefined || entry?._id === null) report.skippedNoId += 1;
    else if (!hasValidDate(entry)) report.skippedNoDate += 1;
    else candidates.push(entry);
  }
  if (!candidates.length) return report;

  const stored = new Set(await dao.findExistingSessionIds(userId, candidates.map((e) => e._id)));
  const missing = candidates.filter((e) => !stored.has(String(e._id)));
  report.alreadyStored = candidates.length - missing.length;
  report.toCopy = missing.length;

  if (apply && missing.length) {
    report.copied = await dao.insertSessionsIfMissing(missing.map((e) => buildMigrationDoc(userId, e, now)));
  }
  return report;
};

// Removes this user's migrated sessions, but only those whose embedded entry still exists: an entry
// that has since been trimmed from the embedded cache would otherwise be lost, so it is kept and reported.
// `readEmbeddedIds(userId)` (the script passes workoutDao.findEmbeddedHistoryIds) re-reads the embedded ids
// right before an applied delete: a completion may have trimmed entries since the cursor read the user.
const undoUserMigration = async (user, { apply = false, dao = workoutDao, readEmbeddedIds } = {}) => {
  const userId = user._id;
  const migrated = await dao.findSessionIdsBySource(userId, 'migration');
  const snapshot = Array.from(user.workoutHistory || []).map(toPlain).filter((e) => e?._id).map((e) => String(e._id));
  const embedded = new Set(apply && readEmbeddedIds ? await readEmbeddedIds(userId) : snapshot);
  const removable = migrated.filter((id) => embedded.has(id));
  const report = { userId: String(userId), migrated: migrated.length, toDelete: removable.length, keptNotInEmbedded: migrated.length - removable.length, deleted: 0 };
  if (apply && removable.length) report.deleted = await dao.deleteSessionsByIds(userId, removable, 'migration');
  return report;
};

const SUMMARY_KEYS = {
  migrate: ['embedded', 'skippedNoId', 'skippedNoDate', 'alreadyStored', 'toCopy', 'copied'],
  undo: ['migrated', 'toDelete', 'keptNotInEmbedded', 'deleted'],
};

// Runs `migrate` or `undo` over an (async) iterable of users and sums the per-user reports.
const runMigration = async (users, { mode = 'migrate', apply = false, dao = workoutDao, now = new Date(), onUser, readEmbeddedIds } = {}) => {
  const summary = { mode, apply, users: 0 };
  for (const key of SUMMARY_KEYS[mode]) summary[key] = 0;
  for await (const user of users) {
    const report = mode === 'undo' ? await undoUserMigration(user, { apply, dao, readEmbeddedIds }) : await migrateUserHistory(user, { apply, dao, now });
    summary.users += 1;
    for (const key of SUMMARY_KEYS[mode]) summary[key] += report[key];
    if (onUser) onUser(report);
  }
  return summary;
};

module.exports = { COPIED_FIELDS, buildMigrationDoc, migrateUserHistory, undoUserMigration, runMigration };
