// Workout durations are tracked, stored and passed around in whole seconds.

const toWholeSeconds = (seconds) => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * Human readable duration: 35 -> "35 sec", 90 -> "1 min 30 sec", 2100 -> "35 min",
 * 3600 -> "1 hr", 4500 -> "1 hr 15 min". Seconds are dropped once the duration reaches an hour.
 */
export const formatDuration = (seconds) => {
  const total = toWholeSeconds(seconds);
  if (total < 60) return `${total} sec`;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts = [];
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (!hours && secs) parts.push(`${secs} sec`);
  return parts.join(' ');
};

/** Live timer clock: "00:35" (mm:ss), or "1:15:00" (h:mm:ss) from one hour up. */
export const formatClock = (seconds) => {
  const total = toWholeSeconds(seconds);
  const pad = (n) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
};

/** Label describing the format formatClock uses for the given duration. */
export const clockFormatLabel = (seconds) => (toWholeSeconds(seconds) >= 3600 ? 'h:mm:ss' : 'mm:ss');

/**
 * Seconds for a stats/history record. Prefers the canonical seconds field and falls back to
 * legacy minute-only records.
 */
export const secondsFrom = (seconds, legacyMinutes) => {
  const s = Number(seconds);
  if (Number.isFinite(s) && s > 0) return Math.floor(s);
  const m = Number(legacyMinutes);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 60) : 0;
};
