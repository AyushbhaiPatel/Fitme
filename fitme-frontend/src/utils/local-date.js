// Local calendar-date keys ("YYYY-MM-DD") in the browser's time zone.
//
// Build keys only with toLocalDateKey (never `date.toISOString().slice(0, 10)`, which is the UTC
// day) and turn keys back into dates only with parseLocalDateKey (never `new Date('YYYY-MM-DD')`,
// which JavaScript parses as UTC midnight and so lands on the previous local day west of UTC).

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" for the local calendar day of `date` (default: now). */
export const toLocalDateKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Local midnight of a "YYYY-MM-DD" key, or null when the key is not a real calendar date. */
export const parseLocalDateKey = (key) => {
  if (typeof key !== 'string') return null;
  const m = DATE_KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIndex, day);
  // Reject roll-overs such as 2026-02-30.
  if (d.getFullYear() !== year || d.getMonth() !== monthIndex || d.getDate() !== day) return null;
  return d;
};

export const isLocalDateKey = (key) => parseLocalDateKey(key) !== null;

/**
 * The UTC-day key the app used to write (`toISOString().slice(0, 10)`). Only for recognising
 * records written before the local-date convention; never use it to write new data.
 */
export const legacyUtcDateKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};
