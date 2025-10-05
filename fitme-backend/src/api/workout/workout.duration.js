// Workout session durations are stored in whole seconds (`durationSeconds`, `totalWorkoutTimeSeconds`).
// Records written before that only have minute fields; they are read as minutes * 60, never rewritten.

const MAX_DURATION_SECONDS = 24 * 60 * 60;

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

const isPresent = (value) => value !== undefined && value !== null && value !== '';

// Minutes with two decimals, for the legacy minute fields older clients still read.
const secondsToMinutes = (seconds) => Math.round((seconds / 60) * 100) / 100;

// Duration of a completion request in whole seconds, or null when missing/invalid.
// `durationSeconds` wins; `durationMinutes` is accepted from legacy clients.
const resolveDurationSeconds = ({ durationSeconds, durationMinutes } = {}) => {
  const raw = isPresent(durationSeconds) ? toNumber(durationSeconds) : isPresent(durationMinutes) ? toNumber(durationMinutes) * 60 : NaN;
  if (!Number.isFinite(raw) || raw < 0 || raw > MAX_DURATION_SECONDS) return null;
  return Math.round(raw);
};

const entrySeconds = (entry) => {
  if (!entry) return 0;
  if (Number.isFinite(entry.durationSeconds)) return entry.durationSeconds;
  return Math.round((Number(entry.durationMinutes) || 0) * 60);
};

const userTotalSeconds = (user) => {
  if (!user) return 0;
  if (Number.isFinite(user.totalWorkoutTimeSeconds)) return user.totalWorkoutTimeSeconds;
  return Math.round((Number(user.totalWorkoutTimeMinutes) || 0) * 60);
};

const userAverageSeconds = (user) => {
  const count = Number(user?.totalWorkouts) || 0;
  return count > 0 ? Math.round(userTotalSeconds(user) / count) : 0;
};

module.exports = { MAX_DURATION_SECONDS, secondsToMinutes, resolveDurationSeconds, entrySeconds, userTotalSeconds, userAverageSeconds };
