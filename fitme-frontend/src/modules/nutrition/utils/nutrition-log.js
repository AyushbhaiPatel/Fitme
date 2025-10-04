// Nutrition log ("cumulativeNutrition") and today's routine ("dailyTasks") in user-scoped storage.
//
// cumulativeNutrition: { "YYYY-MM-DD": { calories, protein, carbs, fat, completedMeals: ["<time>-<name>"] } }
//   New writes are keyed by the LOCAL calendar day the meal was ticked off (toLocalDateKey).
//   Records written before that were keyed by the UTC day (toISOString) and hold only day totals,
//   no per-meal timestamp, so the local day they belong to cannot be recovered. They are left
//   untouched and read as the calendar day their key names; a new meal on the same day is added
//   into the same record, so old and new entries merge and nothing is counted twice.
//
// dailyTasks: { date: "YYYY-MM-DD", dateBasis: "local", tasks: [{ ..., addedTime: ISO, countedOn? }] }
//   Records without dateBasis are legacy: their `date` is a UTC day.

import { toLocalDateKey, parseLocalDateKey, legacyUtcDateKey } from '../../../utils/local-date.js';

export const NUTRITION_LOG_KEY = 'cumulativeNutrition';
export const DAILY_TASKS_KEY = 'dailyTasks';
export const DAILY_TASKS_DATE_BASIS = 'local';

const MACROS = ['calories', 'protein', 'carbs', 'fat'];
const emptyTotals = () => ({ calories: 0, protein: 0, carbs: 0, fat: 0 });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Parse the stored log; anything unreadable is treated as an empty log. */
export const parseNutritionLog = (raw) => {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const mealIdOf = (task) => `${task?.time}-${task?.name}`;

/** Totals for one local calendar day. */
export const dayTotals = (log, dayKey) => {
  const v = isRecord(log?.[dayKey]) ? log[dayKey] : {};
  const totals = emptyTotals();
  for (const m of MACROS) totals[m] = num(v[m]);
  return totals;
};

/** Totals for today (local calendar day). */
export const todayTotals = (log, now = new Date()) => dayTotals(log, toLocalDateKey(now));

/**
 * Add a completed meal to the log under the local day of `now`. Returns a new log object.
 * A meal already counted today, or in the record the task says it was counted in (a legacy
 * UTC-day record on the day of the upgrade), is not added again.
 */
export const recordCompletedMeal = (log, task, now = new Date()) => {
  const dayKey = toLocalDateKey(now);
  const mealId = mealIdOf(task);
  const countedIn = [dayKey, task?.countedOn].filter(Boolean);
  const alreadyCounted = countedIn.some((k) => isRecord(log?.[k]) && Array.isArray(log[k].completedMeals) && log[k].completedMeals.includes(mealId));
  if (alreadyCounted) return { log, dayKey, added: false };

  const prev = isRecord(log?.[dayKey]) ? log[dayKey] : {};
  const next = { ...prev };
  for (const m of MACROS) next[m] = num(prev[m]) + num(task?.[m]);
  next.completedMeals = [...(Array.isArray(prev.completedMeals) ? prev.completedMeals : []), mealId];
  return { log: { ...log, [dayKey]: next }, dayKey, added: true };
};

/**
 * Sum every logged day whose key falls in [start, end) (local dates).
 * Returns { totals, days } where days is the number of logged days in range.
 */
export const totalsBetween = (log, start, end) => {
  const totals = emptyTotals();
  let days = 0;
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const [key, v] of Object.entries(isRecord(log) ? log : {})) {
    const d = parseLocalDateKey(key);
    if (!d || !isRecord(v)) continue;
    const t = d.getTime();
    if (t < startMs || t >= endMs) continue;
    days += 1;
    for (const m of MACROS) totals[m] += num(v[m]);
  }
  return { totals, days };
};

/**
 * Nutrition per analytics bucket (from buildPeriodBuckets), using the same [start, end) local
 * ranges as the workout series. Year view shows the average per logged day of each month;
 * the other periods show sums.
 */
export const bucketNutritionLog = (buckets, log, period) =>
  buckets.map((b) => {
    const { totals, days } = totalsBetween(log, b.start, b.end);
    if (period !== 'year') return totals;
    const denom = Math.max(1, days);
    const avg = emptyTotals();
    for (const m of MACROS) avg[m] = Math.round(totals[m] / denom);
    return avg;
  });

const localDayOf = (value) => {
  if (!value) return null;
  return toLocalDateKey(new Date(value));
};

/**
 * Today's routine tasks from a stored dailyTasks record, or [] when it belongs to another day.
 * Legacy records (no dateBasis) carry a UTC-day `date`; they are accepted while they are the list
 * the old code would still show (date = today's local or current UTC day), keeping only tasks
 * whose addedTime is today locally. Completed legacy tasks remember the record their nutrition
 * was counted in (countedOn) so ticking them again cannot count them twice.
 */
export const restoreDailyTasks = (saved, now = new Date()) => {
  if (!isRecord(saved) || !Array.isArray(saved.tasks)) return [];
  const today = toLocalDateKey(now);
  if (saved.dateBasis === DAILY_TASKS_DATE_BASIS) {
    return saved.date === today ? saved.tasks : [];
  }
  if (saved.date !== today && saved.date !== legacyUtcDateKey(now)) return [];
  return saved.tasks
    .filter((t) => {
      const day = localDayOf(t?.addedTime);
      return day ? day === today : saved.date === today;
    })
    .map((t) => (t.completed && !t.countedOn ? { ...t, countedOn: saved.date } : t));
};

/** The stored form of today's routine. */
export const serializeDailyTasks = (tasks, now = new Date()) => ({
  date: toLocalDateKey(now),
  dateBasis: DAILY_TASKS_DATE_BASIS,
  tasks,
});

/** True when a stored record is today's routine in the current format (nothing to reset). */
export const isCurrentDailyTasks = (saved, now = new Date()) =>
  isRecord(saved) && saved.dateBasis === DAILY_TASKS_DATE_BASIS && saved.date === toLocalDateKey(now);
