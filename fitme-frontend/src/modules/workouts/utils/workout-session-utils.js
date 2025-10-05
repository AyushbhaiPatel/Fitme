// Pure helpers for summarising and saving a workout session (fully or partially completed).
// Durations are whole seconds; calories are whole numbers.

/** Number of sets an exercise is made of. Exercises without a valid `sets` count as one unit of work. */
export const getTotalSets = (exercise) => {
  const sets = Math.floor(Number(exercise?.sets));
  return Number.isFinite(sets) && sets > 0 ? sets : 1;
};

/**
 * Sets completed for one exercise. A fully completed exercise counts all its sets; otherwise the
 * tracked count is clamped to [0, totalSets - 1] so a partial exercise is never reported as done.
 */
export const getCompletedSets = (exercise, { isFullyCompleted = false, setsDone = 0 } = {}) => {
  const total = getTotalSets(exercise);
  if (isFullyCompleted) return total;
  const done = Math.floor(Number(setsDone));
  if (!Number.isFinite(done) || done <= 0) return 0;
  return Math.min(done, total - 1);
};

/** Calories for `completedSets` of `totalSets` (e.g. 2 of 4 sets of 70 cal = 35), rounded to whole calories. */
export const proportionalCalories = (calories, completedSets, totalSets) => {
  const cal = Number(calories);
  const done = Number(completedSets);
  const total = Number(totalSets);
  if (!Number.isFinite(cal) || cal <= 0 || !Number.isFinite(done) || done <= 0 || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  if (done >= total) return Math.round(cal);
  return Math.round((cal * done) / total);
};

/**
 * Summary of a session for one workout day.
 * @param {object[]} exercises      the day's exercises
 * @param {Set<number>|number[]} completedExercises  indices of fully completed exercises
 * @param {Record<number, number>} setsDone          completed-set counts per exercise index
 */
export const buildSessionSummary = ({ exercises = [], completedExercises = new Set(), setsDone = {} } = {}) => {
  const fullyDone = new Set(completedExercises);
  const list = Array.isArray(exercises) ? exercises : [];

  const rows = list.map((exercise, index) => {
    const totalSets = getTotalSets(exercise);
    const fullyCompleted = fullyDone.has(index);
    const completedSets = getCompletedSets(exercise, { isFullyCompleted: fullyCompleted, setsDone: setsDone?.[index] });
    // Fully completed exercises keep their full calorie value exactly as before.
    const caloriesBurned = fullyCompleted
      ? Number(exercise?.calories_burned) || 0
      : proportionalCalories(exercise?.calories_burned, completedSets, totalSets);
    return {
      index,
      name: exercise?.name || 'Unknown Exercise',
      totalSets,
      completedSets,
      fullyCompleted,
      caloriesBurned,
    };
  });

  const done = rows.filter((row) => row.completedSets > 0);
  const fullyCompletedCount = rows.filter((row) => row.fullyCompleted).length;

  return {
    exercises: done,
    totalExercises: rows.length,
    fullyCompletedCount,
    partialCount: done.length - fullyCompletedCount,
    completedSets: rows.reduce((sum, row) => sum + row.completedSets, 0),
    totalSets: rows.reduce((sum, row) => sum + row.totalSets, 0),
    totalCalories: done.reduce((sum, row) => sum + row.caloriesBurned, 0),
    isFullyComplete: rows.length > 0 && fullyCompletedCount === rows.length,
    hasProgress: done.length > 0,
  };
};

/**
 * Body for POST /workouts/complete. Only exercises with at least one completed set are sent;
 * partially done exercises are `completed: false` with proportional calories.
 * `completedSets` / `totalSets` are informational (the current history schema drops them).
 * `clientSessionId` is the session's idempotency key; it is sent whenever provided.
 */
export const buildCompletionPayload = ({ workoutId = null, dayData, summary, durationSeconds, clientSessionId }) => {
  const seconds = Math.floor(Number(durationSeconds));
  return {
    ...(clientSessionId ? { clientSessionId } : {}),
    workoutId: workoutId || null,
    caloriesBurned: summary.totalCalories,
    durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    completedExercises: summary.exercises.map((row) => ({
      name: row.name,
      completed: row.fullyCompleted,
      caloriesBurned: row.caloriesBurned,
      completedSets: row.completedSets,
      totalSets: row.totalSets,
    })),
    workoutName: `${dayData?.day || 'Workout'} - ${dayData?.workout_type || 'Custom'}`,
  };
};
