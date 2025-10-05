// Lifetime workout counters on the user document, applied atomically per completed session.
//
// `nextCounters` is the reference definition (plain JS). `buildApplyUpdate` is the same computation as
// a MongoDB update pipeline, so it runs as ONE atomic single-document write on the server:
//   - counters are incremented from the values stored at that moment (no read-modify-save, no lost updates);
//   - a legacy user without `totalWorkoutTimeSeconds` is carried over as round(totalWorkoutTimeMinutes * 60)
//     inside the same write, so the carry-over happens exactly once (afterwards the field exists);
//   - the derived legacy minute fields are recomputed from the new seconds total in the same write;
//   - the session is appended to the embedded recent-history cache in the same write.
// The filter makes the write conditional: it applies only while the session is not in the cache yet and the
// cache-trim epoch is unchanged (see workout.recorder.js for why that makes it exactly-once).
//
// Rounding: Math.round(x) is floor(x + 0.5) for these values; the pipeline uses that form because
// MongoDB's $round rounds half to even. `secondsToMinutes(s)` = floor((s / 60) * 100 + 0.5) / 100.

const { secondsToMinutes, userTotalSeconds } = require('./workout.duration');

const EPOCH_FIELD = 'workoutCacheTrimEpoch';

const epochOf = (user) => (Number.isInteger(user?.[EPOCH_FIELD]) ? user[EPOCH_FIELD] : 0);

// Counter values after adding `entry` ({ durationSeconds, caloriesBurned }) to `user`.
const nextCounters = (user, entry) => {
  const totalWorkouts = (Number(user?.totalWorkouts) || 0) + 1;
  const totalWorkoutTimeSeconds = userTotalSeconds(user) + entry.durationSeconds;
  return {
    totalWorkouts,
    totalCaloriesBurned: (Number(user?.totalCaloriesBurned) || 0) + entry.caloriesBurned,
    totalWorkoutTimeSeconds,
    totalWorkoutTimeMinutes: secondsToMinutes(totalWorkoutTimeSeconds),
    averageWorkoutTimeMinutes: secondsToMinutes(Math.round(totalWorkoutTimeSeconds / totalWorkouts)),
  };
};

const roundHalfUp = (expr) => ({ $floor: { $add: [expr, 0.5] } });
const secondsToMinutesExpr = (secondsExpr) => ({ $divide: [roundHalfUp({ $multiply: [{ $divide: [secondsExpr, 60] }, 100] }), 100] });

// Filter + pipeline for one conditional atomic apply. `entry` is the embedded cache entry (with `_id`).
const buildApplyUpdate = (userId, entry, expectedEpoch) => ({
  filter: {
    _id: userId,
    'workoutHistory._id': { $ne: entry._id },
    $expr: { $eq: [{ $ifNull: [`$${EPOCH_FIELD}`, 0] }, expectedEpoch] },
  },
  pipeline: [
    {
      $set: {
        totalWorkoutTimeSeconds: {
          $add: [
            { $ifNull: ['$totalWorkoutTimeSeconds', roundHalfUp({ $multiply: [{ $ifNull: ['$totalWorkoutTimeMinutes', 0] }, 60] })] },
            entry.durationSeconds,
          ],
        },
        totalWorkouts: { $add: [{ $ifNull: ['$totalWorkouts', 0] }, 1] },
        totalCaloriesBurned: { $add: [{ $ifNull: ['$totalCaloriesBurned', 0] }, entry.caloriesBurned] },
        // $literal: user-supplied strings (workout/exercise names) are never read as field paths or operators.
        workoutHistory: { $concatArrays: [{ $ifNull: ['$workoutHistory', []] }, [{ $literal: entry }]] },
        updated_at: '$$NOW',
      },
    },
    {
      $set: {
        totalWorkoutTimeMinutes: secondsToMinutesExpr('$totalWorkoutTimeSeconds'),
        averageWorkoutTimeMinutes: secondsToMinutesExpr(roundHalfUp({ $divide: ['$totalWorkoutTimeSeconds', '$totalWorkouts'] })),
      },
    },
  ],
});

module.exports = { EPOCH_FIELD, epochOf, nextCounters, buildApplyUpdate };
