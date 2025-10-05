const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');

const workoutDao = require('./workout.dao');
const WorkoutSession = require('./workout-session.model');
const { buildMigrationDoc, migrateUserHistory, undoUserMigration, runMigration } = require('./workout.migration');
const { installSessionStore } = require('./workout.testkit');
const { parseArgs } = require('../../../scripts/migrate-workout-history');

// The dao is mocked (in-memory session store); nothing touches the database.

const oid = (hex) => (hex ? new Types.ObjectId(hex) : new Types.ObjectId());

// Shape of the one real legacy record (lean document as the script reads it).
const legacyUser = () => ({
  _id: oid('6af86564a4a4013c286ff4be'),
  totalWorkouts: 1,
  totalCaloriesBurned: 200,
  totalWorkoutTimeMinutes: 1,
  averageWorkoutTimeMinutes: 1,
  workoutHistory: [{ _id: oid('6af86ada4bfdc6f87f055077'), durationMinutes: 1, caloriesBurned: 200, completedAt: new Date('2026-05-10T10:00:00Z'), workoutName: 'Old', exercises: [] }],
});

const modernUser = () => {
  const _id = oid();
  return {
    _id,
    workoutHistory: [
      { _id: oid(), workoutId: null, durationSeconds: 35, durationMinutes: 0.58, caloriesBurned: 50, completedAt: new Date('2026-11-01T10:00:00Z'), workoutName: 'A', exercises: [{ _id: oid(), name: 'Squat', completed: true, caloriesBurned: 20 }] },
      { _id: oid(), durationSeconds: 90, durationMinutes: 1.5, caloriesBurned: 70, completedAt: new Date('2026-11-02T10:00:00Z'), workoutName: 'B', exercises: [] },
      { durationMinutes: 5, caloriesBurned: 1, completedAt: new Date('2026-01-01T00:00:00Z') }, // no _id
      { _id: oid(), durationSeconds: 10, caloriesBurned: 1 }, // no date
    ],
  };
};

const NOW = new Date('2026-11-14T12:00:00Z');

afterEach(() => mock.restoreAll());

describe('migrateUserHistory', () => {
  test('dry run (default) reports what would be copied and writes nothing', async () => {
    const store = installSessionStore();
    const report = await migrateUserHistory(modernUser());
    assert.deepEqual({ ...report, userId: undefined }, { userId: undefined, embedded: 4, skippedNoId: 1, skippedNoDate: 1, alreadyStored: 0, toCopy: 2, copied: 0 });
    assert.equal(store.insertMissing.mock.callCount(), 0);
    assert.equal(store.store.length, 0);
  });

  test('--apply copies missing entries with the same _id; re-running is a no-op (idempotent)', async () => {
    const store = installSessionStore();
    const user = modernUser();
    const first = await migrateUserHistory(user, { apply: true, now: NOW });
    assert.equal(first.copied, 2);
    assert.deepEqual(store.store.map((d) => String(d._id)), [String(user.workoutHistory[0]._id), String(user.workoutHistory[1]._id)]);
    assert.ok(store.store.every((d) => d.source === 'migration' && String(d.user) === String(user._id)));

    const second = await migrateUserHistory(user, { apply: true, now: NOW });
    assert.deepEqual([second.alreadyStored, second.toCopy, second.copied], [2, 0, 0]);
    assert.equal(store.store.length, 2);
  });

  test('sessions already written by completions are not copied again', async () => {
    const user = modernUser();
    const store = installSessionStore({ sessions: [{ _id: user.workoutHistory[0]._id, user: user._id, completedAt: user.workoutHistory[0].completedAt, durationSeconds: 35, source: 'completion' }] });
    const report = await migrateUserHistory(user, { apply: true, now: NOW });
    assert.deepEqual([report.alreadyStored, report.copied], [1, 1]);
    assert.equal(store.store.length, 2);
    assert.equal(store.store[0].source, 'completion'); // existing session untouched
  });

  test('the real legacy record: copied as-is (minutes only), the user and its entry are not modified', async () => {
    const store = installSessionStore();
    const user = legacyUser();
    const report = await migrateUserHistory(user, { apply: true, now: NOW });
    assert.equal(report.copied, 1);
    assert.deepEqual(user, legacyUser());

    const [doc] = store.store;
    assert.equal(String(doc._id), '6af86ada4bfdc6f87f055077');
    assert.equal(doc.durationMinutes, 1);
    assert.equal('durationSeconds' in doc, false);
    assert.deepEqual(
      { ...doc, _id: String(doc._id), user: String(doc.user) },
      { _id: '6af86ada4bfdc6f87f055077', user: '6af86564a4a4013c286ff4be', completedAt: new Date('2026-05-10T10:00:00Z'), durationMinutes: 1, caloriesBurned: 200, workoutName: 'Old', exercises: [], source: 'migration', recordedAt: NOW },
    );

    // Casting through the model adds no duration either.
    const cast = new WorkoutSession(doc);
    assert.equal(cast.validateSync(), undefined);
    assert.equal('durationSeconds' in cast.toObject(), false);
    assert.equal(cast.durationMinutes, 1);
  });

  test('works on hydrated user documents too', async () => {
    const User = require('../user/user.model');
    const store = installSessionStore();
    const doc = User.hydrate({ ...legacyUser(), email: 'l@example.com', firstName: 'L', lastName: 'U' });
    assert.equal((await migrateUserHistory(doc, { apply: true, now: NOW })).copied, 1);
    assert.equal('durationSeconds' in store.store[0], false);
    assert.equal(doc.workoutHistory[0].durationSeconds, undefined);
  });

  test('buildMigrationDoc copies only present fields', () => {
    const entry = { _id: oid(), completedAt: NOW, caloriesBurned: 0, durationSeconds: 0, extraneous: 'x' };
    assert.deepEqual(Object.keys(buildMigrationDoc('u', entry, NOW)).sort(), ['_id', 'caloriesBurned', 'completedAt', 'durationSeconds', 'recordedAt', 'source', 'user']);
  });
});

describe('undoUserMigration', () => {
  test('dry run reports, apply deletes only migrated copies whose embedded entry still exists', async () => {
    const user = modernUser();
    const trimmed = { _id: oid(), user: user._id, completedAt: NOW, durationSeconds: 5, source: 'migration' }; // no longer in the cache
    const fromCompletion = { _id: oid(), user: user._id, completedAt: NOW, durationSeconds: 5, source: 'completion' };
    const store = installSessionStore({ sessions: [trimmed, fromCompletion] });
    await migrateUserHistory(user, { apply: true, now: NOW });
    assert.equal(store.store.length, 4);

    const dry = await undoUserMigration(user);
    assert.deepEqual([dry.migrated, dry.toDelete, dry.keptNotInEmbedded, dry.deleted], [3, 2, 1, 0]);
    assert.equal(store.store.length, 4);

    const applied = await undoUserMigration(user, { apply: true });
    assert.equal(applied.deleted, 2);
    assert.deepEqual(store.store.map((d) => String(d._id)).sort(), [String(trimmed._id), String(fromCompletion._id)].sort());

    // Undo then migrate again restores the same state.
    await migrateUserHistory(user, { apply: true, now: NOW });
    assert.equal(store.store.length, 4);
  });
});

describe('runMigration', () => {
  async function* users(list) { for (const u of list) yield u; }

  test('sums reports over an async iterable; dry run then apply then re-run', async () => {
    const store = installSessionStore();
    const list = [legacyUser(), modernUser(), { _id: oid(), workoutHistory: [] }];
    const dry = await runMigration(users(list));
    assert.deepEqual(dry, { mode: 'migrate', apply: false, users: 3, embedded: 5, skippedNoId: 1, skippedNoDate: 1, alreadyStored: 0, toCopy: 3, copied: 0 });
    assert.equal(store.store.length, 0);

    const applied = await runMigration(users(list), { apply: true, now: NOW });
    assert.equal(applied.copied, 3);
    const again = await runMigration(users(list), { apply: true, now: NOW });
    assert.deepEqual([again.alreadyStored, again.toCopy, again.copied], [3, 0, 0]);
    assert.equal(store.store.length, 3);

    const undo = await runMigration(users(list), { mode: 'undo', apply: true });
    assert.deepEqual([undo.migrated, undo.deleted], [3, 3]);
    assert.equal(store.store.length, 0);
  });
});

describe('dao.insertSessionsIfMissing', () => {
  test('upserts with $setOnInsert keyed by _id, so an existing session is never modified', async () => {
    const bulk = mock.method(WorkoutSession, 'bulkWrite', async () => ({ upsertedCount: 1 }));
    const doc = buildMigrationDoc(oid(), legacyUser().workoutHistory[0], NOW);
    assert.equal(await workoutDao.insertSessionsIfMissing([doc]), 1);
    const [ops, options] = bulk.mock.calls[0].arguments;
    assert.deepEqual(options, { ordered: false, throwOnValidationError: true });
    const { filter, update, upsert, setDefaultsOnInsert } = ops[0].updateOne;
    assert.deepEqual(filter, { _id: doc._id });
    assert.deepEqual(Object.keys(update), ['$setOnInsert']);
    assert.equal('_id' in update.$setOnInsert, false);
    assert.equal('durationSeconds' in update.$setOnInsert, false);
    assert.equal(upsert, true);
    assert.equal(setDefaultsOnInsert, false);
  });

  test('duplicate-key races are treated as already stored; other errors propagate', async () => {
    const dup = Object.assign(new Error('E11000'), { writeErrors: [{ code: 11000 }], result: { upsertedCount: 0 } });
    mock.method(WorkoutSession, 'bulkWrite', async () => { throw dup; });
    assert.equal(await workoutDao.insertSessionsIfMissing([{ _id: oid() }]), 0);
    mock.restoreAll();
    mock.method(WorkoutSession, 'bulkWrite', async () => { throw new Error('network'); });
    await assert.rejects(workoutDao.insertSessionsIfMissing([{ _id: oid() }]), /network/);
  });

  test('empty input does not hit the database', async () => {
    const bulk = mock.method(WorkoutSession, 'bulkWrite', async () => ({}));
    assert.equal(await workoutDao.insertSessionsIfMissing([]), 0);
    assert.equal(bulk.mock.callCount(), 0);
  });
});

describe('migration script arguments', () => {
  test('dry run unless --apply is given', () => {
    assert.deepEqual(parseArgs([]), { apply: false, undo: false, user: null, verbose: false });
    assert.equal(parseArgs(['--apply']).apply, true);
    assert.deepEqual(parseArgs(['--undo']), { apply: false, undo: true, user: null, verbose: false });
    assert.equal(parseArgs(['--user', '6af86564a4a4013c286ff4be']).user, '6af86564a4a4013c286ff4be');
    assert.throws(() => parseArgs(['--user', 'nope']), /valid user id/);
    assert.throws(() => parseArgs(['--force']), /Unknown argument/);
  });
});
