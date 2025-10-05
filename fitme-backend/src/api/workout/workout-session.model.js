const mongoose = require('mongoose');

// Complete, unbounded workout history: one document per finished session.
// `user.workoutHistory` stays as a small recent-entries cache for compatibility (see workout.history.js).
//
// Identity: a session's `_id` is the `_id` of the matching embedded `user.workoutHistory` subdocument.
// New completions generate one id and write it to both places; the migration copies embedded entries
// with their own `_id`. That makes dedup between the two stores and migration re-runs exact.
//
// Durations: `durationSeconds` is canonical. Like the user model, neither duration field has a default,
// so a copied legacy minute-only entry keeps only `durationMinutes` and is read as minutes * 60.

const sessionExerciseSchema = new mongoose.Schema({ name: String, completed: Boolean, caloriesBurned: Number, completedSets: Number, totalSets: Number });

const workoutSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: { type: Date, required: true },
  durationSeconds: { type: Number, min: 0 },
  durationMinutes: { type: Number },
  caloriesBurned: { type: Number },
  workoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkoutPlan' },
  workoutName: String,
  exercises: [sessionExerciseSchema],
  // 'completion' = written by POST /workouts/complete; 'migration' = copied by scripts/migrate-workout-history.js.
  source: { type: String, enum: ['completion', 'migration'], required: true },
  recordedAt: { type: Date },
  // Idempotency key sent by the client (body `clientSessionId` or `Idempotency-Key` header), unique per user.
  // Absent on migrated copies, sessions from clients without a key and sessions written before keys existed.
  clientSessionId: { type: String },
  // Exactly-once bookkeeping for the user's lifetime counters (see workout.recorder.js). No default:
  //   false  = claimed by a completion, counters not confirmed applied yet (reconciled on the next request);
  //   true   = counters applied (and the session is in, or was trimmed from, the embedded cache);
  //   absent = counted before this field existed (old completions, migrated copies): never re-applied.
  countersApplied: { type: Boolean },
  countersAppliedAt: { type: Date },
});

// Range queries and newest/oldest-first pagination per user; `_id` makes the order total.
workoutSessionSchema.index({ user: 1, completedAt: -1, _id: -1 });

// The idempotency claim: at most one session per (user, clientSessionId). Partial, so the many documents
// without a key (migrated copies, keyless completions) never collide with each other.
workoutSessionSchema.index(
  { user: 1, clientSessionId: 1 },
  { unique: true, name: 'user_clientSessionId_unique', partialFilterExpression: { clientSessionId: { $type: 'string' } } },
);

// Small index over sessions whose counters are still pending (normally empty), for reconciliation.
workoutSessionSchema.index({ user: 1 }, { name: 'user_countersPending', partialFilterExpression: { countersApplied: false } });

module.exports = mongoose.model('WorkoutSession', workoutSessionSchema);
