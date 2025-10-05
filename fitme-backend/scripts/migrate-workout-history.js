#!/usr/bin/env node
// Backfills embedded `user.workoutHistory` entries into the WorkoutSession collection.
// Never run automatically. Dry run by default: it only reads and prints what it would do.
//
//   node scripts/migrate-workout-history.js                 # dry run, all users
//   node scripts/migrate-workout-history.js --user <id>     # dry run, one user
//   node scripts/migrate-workout-history.js --apply         # copy missing entries (safe to re-run)
//   node scripts/migrate-workout-history.js --undo          # dry run of the undo
//   node scripts/migrate-workout-history.js --undo --apply  # delete sessions created by this script
//
// Requires MONGODB_URI (no localhost fallback). Copies keep the embedded entry's _id and its fields
// unchanged (legacy minute-only entries stay minute-only); users and embedded entries are never
// modified. Undo deletes only `source: 'migration'` sessions whose embedded entry still exists, so it
// cannot lose a session that has since been trimmed from the embedded cache; those are reported.

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/api/user/user.model');
const { runMigration } = require('../src/api/workout/workout.migration');
const workoutDao = require('../src/api/workout/workout.dao');

const parseArgs = (argv) => {
  const args = { apply: false, undo: false, user: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--undo') args.undo = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--user') args.user = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.user !== null && !mongoose.isValidObjectId(args.user)) throw new Error('--user needs a valid user id');
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  // No index builds or collection creation on connect: a dry run must not write anything.
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(`${args.undo ? 'UNDO' : 'MIGRATE'} ${args.apply ? '(APPLY: writes enabled)' : '(dry run: no writes)'}`);

  try {
    let users;
    if (args.undo) {
      const ids = args.user ? [args.user] : await workoutDao.findUserIdsWithSessionSource('migration');
      users = User.find({ _id: { $in: ids } }).select('_id workoutHistory._id').lean().cursor();
    } else {
      const filter = { 'workoutHistory.0': { $exists: true } };
      if (args.user) filter._id = args.user;
      users = User.find(filter).select('_id workoutHistory').lean().cursor();
    }

    const summary = await runMigration(users, {
      mode: args.undo ? 'undo' : 'migrate',
      apply: args.apply,
      // Undo re-reads each user's embedded ids right before deleting (entries may have been trimmed since).
      readEmbeddedIds: workoutDao.findEmbeddedHistoryIds,
      onUser: args.verbose ? (r) => console.log(JSON.stringify(r)) : undefined,
    });
    console.log(JSON.stringify(summary, null, 2));
    if (!args.apply) console.log('Dry run only. Re-run with --apply to write.');
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
