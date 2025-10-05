// Chart buckets for the analytics periods, in the browser's local time (the same calendar the
// backend weekly summary uses when given the browser's time zone). Each bucket covers [start, end).
// `date` is the anchor the nutrition aggregation keys off (the Monday of a week in month view).

const shortMonth = (d) => d.toLocaleDateString(undefined, { month: 'short' });

const mondayOf = (d) => {
  const offset = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
};

export const buildPeriodBuckets = (period, now = new Date()) => {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (period) {
    case 'week': {
      const monday = mondayOf(now);
      return Array.from({ length: 7 }, (_, i) => {
        const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        return { date: start, start, end, label: start.toLocaleDateString(undefined, { weekday: 'short' }) };
      });
    }

    case 'month': {
      // Monday-based weeks overlapping this month, clipped to the month so a "Nov 1-2" bucket
      // does not count the October days of that week.
      const monthStart = new Date(year, month, 1);
      const nextMonthStart = new Date(year, month + 1, 1);
      const buckets = [];
      for (let monday = mondayOf(monthStart); monday < nextMonthStart; monday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)) {
        const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
        const start = monday < monthStart ? monthStart : monday;
        const end = nextMonday > nextMonthStart ? nextMonthStart : nextMonday;
        const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
        buckets.push({ date: monday, start, end, label: `${shortMonth(start)} ${start.getDate()}-${lastDay.getDate()}` });
      }
      return buckets;
    }

    case 'quarter':
      return Array.from({ length: 4 }, (_, i) => {
        const start = new Date(year, i * 3, 1);
        return { date: start, start, end: new Date(year, i * 3 + 3, 1), label: `Q${i + 1}` };
      });

    case 'year':
      return Array.from({ length: 12 }, (_, i) => {
        const start = new Date(year, i, 1);
        return { date: start, start, end: new Date(year, i + 1, 1), label: shortMonth(start) };
      });

    default:
      return [];
  }
};

/** Workouts and calories burned per bucket, from backend workout history entries. */
export const bucketWorkoutHistory = (buckets, history) => {
  const totals = buckets.map(() => ({ workouts: 0, calories: 0 }));
  for (const entry of Array.isArray(history) ? history : []) {
    if (!entry?.completedAt) continue;
    const t = new Date(entry.completedAt).getTime();
    if (Number.isNaN(t)) continue;
    const index = buckets.findIndex((b) => t >= b.start.getTime() && t < b.end.getTime());
    if (index === -1) continue;
    totals[index].workouts += 1;
    totals[index].calories += Math.round(Number(entry.caloriesBurned) || 0);
  }
  return totals;
};
