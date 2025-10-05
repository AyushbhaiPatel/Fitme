const mongoose = require('mongoose');
const { Format } = require('../../config/format');
const workoutDao = require('./workout.dao');
const history = require('./workout.history');
const recorder = require('./workout.recorder');
const gemini = require('../../config/gemini');
const { secondsToMinutes, resolveDurationSeconds, entrySeconds, userTotalSeconds, userAverageSeconds } = require('./workout.duration');

// Helpers

const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return 25;
  const today = new Date();
  const birth = new Date(dateOfBirth);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

const getWorkoutDays = (freq) => ({ '2-3': 3, '3-4': 4, '4-5': 5, '5-6': 6, daily: 7 }[freq] || 3);

const mapGoal = (goal) =>
  ({ 'weight-loss': 'Weight Loss', 'weight-gain': 'Weight Gain', 'muscle-gain': 'Muscle Building', strength: 'Strength Training', 'general-fitness': 'General Fitness' }[goal] || 'General Fitness');

// Used when the user has not picked a focus area in the advanced options.
const DEFAULT_FOCUS_BY_GOAL = {
  'weight-loss': 'Full body with fat-burning cardio',
  'weight-gain': 'Full body strength and mass building',
  'muscle-gain': 'Hypertrophy across all major muscle groups',
  strength: 'Compound lifts for overall strength',
  'general-fitness': 'Balanced full body conditioning',
};

const getDefaultFocusArea = (goal) => DEFAULT_FOCUS_BY_GOAL[goal] || DEFAULT_FOCUS_BY_GOAL['general-fitness'];

// Advanced options are optional: the client sends null (or nothing) when the panel is closed.
const normalizeCustomOptions = (customOptions) => {
  const src = customOptions && typeof customOptions === 'object' && !Array.isArray(customOptions) ? customOptions : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
  return {
    focusArea: str(src.focusArea),
    intensity: str(src.intensity),
    equipment: str(src.equipment),
    specificGoals: str(src.specificGoals),
    duration: str(src.duration),
  };
};

// Upper bound of a duration range: '30-45' -> 45, '90+' -> 90, '60' -> 60.
const parseSessionMinutes = (value) => {
  const nums = String(value ?? '').match(/\d+/g);
  return nums ? parseInt(nums[nums.length - 1], 10) : 45;
};

const buildPrompt = (userData, numberOfDays, duration, customOptions) => {
  const dayLabels = Array.from({ length: numberOfDays }, (_, i) => `Day ${i + 1}`);
  const { focusArea, intensity, equipment, specificGoals } = normalizeCustomOptions(customOptions);
  const effectiveFocus = focusArea || getDefaultFocusArea(userData.goal);

  return `You are an expert fitness trainer. Create a personalized ${numberOfDays}-day workout plan.

USER PROFILE:
- Primary Goal: ${mapGoal(userData.goal)}
- Experience: ${userData.fitnessExperience}
- Preferred Workouts: ${(userData.preferredWorkouts || []).join(', ') || 'varied'}
- Frequency: ${userData.workoutFrequency} times/week
- Session Duration: ${duration} minutes
- Height: ${userData.height || 'N/A'} cm, Weight: ${userData.weight || 'N/A'} kg
- Age: ${userData.age || 'N/A'}, Gender: ${userData.gender || 'N/A'}
- Focus Area: ${effectiveFocus}${intensity ? `\n- Intensity: ${intensity}` : ''}${equipment ? `\n- Equipment: ${equipment}` : ''}${specificGoals ? `\n- Special Instructions: ${specificGoals}` : ''}

Create exactly ${numberOfDays} workout days (${dayLabels.join(', ')}). Each day: 4-8 exercises with sets, reps (numbers only, no ranges), rest periods, calorie estimates, and detailed descriptions.

Return ONLY valid JSON:
{
  "name": "Plan Name",
  "goal": "Goal",
  "duration_per_day_minutes": ${duration},
  "preference": ["type1"],
  "frequency": "${userData.workoutFrequency}",
  "days": [
    {
      "day": "Day 1",
      "workout_type": "Type",
      "estimated_calories_burned": 300,
      "exercises": [
        {
          "name": "Exercise",
          "type": "Strength",
          "sets": 3,
          "reps": 12,
          "duration_minutes": 0,
          "duration_seconds": 0,
          "rest_between_sets_seconds": 60,
          "calories_burned": 50,
          "description": "Detailed description."
        }
      ]
    }
  ]
}

CRITICAL: All numeric fields must be numbers. No ranges like "8-12". Use null for reps if time-based.`;
};

const parseWorkoutResponse = (text) => {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty AI response');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  let jsonText = jsonMatch[0]
    .replace(/"reps":\s*"([^"]+)"/g, (_, v) => {
      if (v.includes('-')) {
        const [a, b] = v.split('-').map((x) => parseInt(x));
        if (!isNaN(a) && !isNaN(b)) return `"reps": ${Math.round((a + b) / 2)}`;
      }
      const n = parseInt(v);
      return `"reps": ${isNaN(n) ? 'null' : n}`;
    })
    .replace(/"sets":\s*"(\d+)"/g, (_, v) => `"sets": ${parseInt(v)}`)
    .replace(/"calories_burned":\s*"(\d+)"/g, (_, v) => `"calories_burned": ${parseInt(v)}`)
    .replace(/"estimated_calories_burned":\s*"(\d+)"/g, (_, v) => `"estimated_calories_burned": ${parseInt(v)}`);

  const plan = JSON.parse(jsonText);
  if (!plan || !Array.isArray(plan.days)) throw new Error('Invalid plan structure');

  const isObject = (v) => v && typeof v === 'object';
  plan.days = plan.days.filter(isObject).map((day, i) => ({
    day: day.day || `Day ${i + 1}`,
    workout_type: day.workout_type || 'Mixed Training',
    estimated_calories_burned: typeof day.estimated_calories_burned === 'number' ? day.estimated_calories_burned : 300,
    exercises: (Array.isArray(day.exercises) ? day.exercises : []).filter(isObject).map((ex) => ({
      name: ex.name || 'Exercise',
      type: ex.type || 'General',
      sets: typeof ex.sets === 'number' ? ex.sets : 3,
      reps: typeof ex.reps === 'number' ? ex.reps : null,
      duration_minutes: typeof ex.duration_minutes === 'number' && ex.duration_minutes > 0 ? ex.duration_minutes : null,
      duration_seconds: typeof ex.duration_seconds === 'number' && ex.duration_seconds > 0 ? ex.duration_seconds : null,
      rest_between_sets_seconds: typeof ex.rest_between_sets_seconds === 'number' ? ex.rest_between_sets_seconds : 60,
      calories_burned: typeof ex.calories_burned === 'number' ? ex.calories_burned : 50,
      description: ex.description || '',
    })),
  })).filter((day) => day.exercises.length > 0);

  if (plan.days.length === 0) throw new Error('AI response contained no usable workout days');

  return plan;
};

const calcExerciseCalories = (ex) => {
  const duration = parseInt(ex.duration) || 0;
  if (duration > 0) return duration * 5;
  return Math.max((parseInt(ex.sets) || 1) * (parseInt(ex.reps) || 10) * 0.5, 20);
};

const calcWorkoutDuration = (exercises) => {
  let total = 0;
  exercises.forEach((ex) => {
    if (ex.duration) total += parseInt(ex.duration) || 0;
    else if (ex.sets && ex.reps) {
      const sets = parseInt(ex.sets) || 1;
      total += sets * 0.5 + ((ex.rest || 60) * sets) / 60;
    } else total += 5;
  });
  return Math.max(total, 10);
};

// Error envelope shared with the AI coach: { code, success: false, message, errorCode[, retryAfter] }.
const aiFailure = (code, errorCode, message, retryAfter) => {
  const res = { ...Format.response(code, false, message), errorCode };
  if (retryAfter) res.retryAfter = retryAfter;
  return res;
};

// A 429 that gemini.generateContent gave up on without retrying: the provider asked for a longer wait than
// we retry for (an exhausted daily quota says "retry in ~16h"), or the violated quota is a per-day one.
const isQuotaExhausted = (err) => {
  if (!gemini.isRateLimitError(err)) return false;
  const retryAfter = gemini.getRetryAfterSeconds(err);
  if (retryAfter && retryAfter > gemini.retryConfig.maxRetryAfterSeconds) return true;
  const details = Array.isArray(err.errorDetails) ? err.errorDetails : [];
  return details.some((d) => Array.isArray(d?.violations) && d.violations.some((v) => /PerDay/i.test(String(v?.quotaId || ''))));
};

// Maps a gemini.generateContent failure to a user-facing response without provider text.
const mapWorkoutProviderError = (err) => {
  const message = String(err?.message || '');
  if (isQuotaExhausted(err)) {
    return aiFailure(503, 'AI_QUOTA_EXCEEDED', 'AI workout generation is temporarily unavailable because the daily AI quota has been reached. Please try again later.', gemini.getRetryAfterSeconds(err));
  }
  if (gemini.isRateLimitError(err)) {
    return aiFailure(429, 'AI_RATE_LIMITED', 'The AI service is busy right now. Please try again in a minute.', gemini.getRetryAfterSeconds(err));
  }
  if (gemini.isAuthError(err) || /Gemini not initialized/.test(message)) {
    return aiFailure(503, 'AI_AUTH_ERROR', 'AI workout generation is temporarily unavailable due to a server configuration problem.');
  }
  if (err?.status === 404) {
    return aiFailure(503, 'AI_MODEL_UNAVAILABLE', 'AI workout generation is temporarily unavailable. Please try again later.');
  }
  if (err?.status === 504 || err?.name === 'AbortError' || (!err?.status && /aborted|timed? ?out|timeout/i.test(message))) {
    return aiFailure(504, 'AI_TIMEOUT', 'The AI took too long to respond. Please try again.');
  }
  if (!err?.status && err?.response) {
    // GoogleGenerativeAIResponseError: the reply was blocked (safety / recitation) and has no text.
    return aiFailure(502, 'AI_RESPONSE_BLOCKED', 'The AI could not create a plan for these options. Try changing the specific goals or instructions.');
  }
  if (!err?.status && /fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network/i.test(message)) {
    return aiFailure(503, 'AI_UNAVAILABLE', 'The AI service could not be reached. Please try again in a few minutes.');
  }
  return aiFailure(502, 'AI_PROVIDER_ERROR', 'AI workout generation failed. Please try again.');
};

// Service functions

module.exports.generateWorkoutPlan = async (userId, body) => {
  const user = await workoutDao.findUserById(userId);
  if (!user) return Format.notFound('User not found');

  body = body || {};
  const customOptions = normalizeCustomOptions(body.customOptions);
  const userData = {
    goal: user.fitnessGoals?.[0] || 'general-fitness',
    weight: user.weight,
    height: user.height,
    age: calculateAge(user.dateOfBirth),
    gender: user.gender,
    fitnessExperience: body.fitnessExperience || user.fitnessExperience || 'beginner',
    preferredWorkouts: user.preferredWorkouts ? user.preferredWorkouts.split(',').map((s) => s.trim()) : [],
    workoutFrequency: body.workoutFrequency || user.workoutFrequency || '3-4',
    workoutDuration: customOptions.duration || body.workoutDuration || user.workoutDuration || '30-45',
  };

  const numberOfDays = getWorkoutDays(userData.workoutFrequency);
  const duration = parseSessionMinutes(userData.workoutDuration);

  if (!gemini.isAvailable()) {
    return aiFailure(503, 'AI_NOT_CONFIGURED', 'AI workout generation is not configured on the server.');
  }

  // Surface failures instead of masking them with a demo plan. Provider details stay in the server log.
  let raw;
  try {
    raw = await gemini.generateContent(buildPrompt(userData, numberOfDays, duration, customOptions), {}, { label: 'workout' });
  } catch (err) {
    console.error('Gemini workout generation failed:', err.message);
    return mapWorkoutProviderError(err);
  }
  try {
    const workoutPlan = parseWorkoutResponse(raw);
    return Format.success({ workoutPlan, isAIGenerated: true, isDemoMode: false });
  } catch (err) {
    console.error('Gemini workout response unusable:', err.message);
    return aiFailure(502, 'AI_INVALID_RESPONSE', 'The AI returned an incomplete workout plan. Please try again.');
  }
};

// Exposed for unit tests.
module.exports._internal = { buildPrompt, parseWorkoutResponse, normalizeCustomOptions, getDefaultFocusArea, parseSessionMinutes };

// Integer query param clamped to `max`; null when present but not an integer >= min.
const parseIntParam = (value, fallback, min, max) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) return null;
  return Math.min(n, max);
};

module.exports.saveWorkoutPlan = async (userId, { workoutPlan, name }) => {
  if (!workoutPlan || typeof workoutPlan !== 'object' || Array.isArray(workoutPlan)) return Format.badRequest('Workout plan data is required');
  if (typeof name !== 'string' || !name.trim()) return Format.badRequest('Workout plan name is required');
  if (!workoutPlan.goal) return Format.badRequest('Workout plan goal is required');

  const saved = await workoutDao.createPlan({
    userId,
    name: name.trim(),
    goal: workoutPlan.goal,
    duration_per_day_minutes: workoutPlan.duration_per_day_minutes,
    preference: workoutPlan.preference || [],
    days: workoutPlan.days || [],
    isAIGenerated: workoutPlan.isAIGenerated || false,
  });

  return Format.created({ workoutPlan: saved }, 'Workout plan saved successfully');
};

module.exports.getSavedWorkoutPlans = async (userId, query) => {
  const { sort = 'createdAt' } = query || {};
  const page = parseIntParam(query?.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = parseIntParam(query?.limit, 10, 1, 100);
  if (page === null) return Format.badRequest('`page` must be a positive integer');
  if (limit === null) return Format.badRequest('`limit` must be a positive integer');
  const sortMap = { name: { name: 1 }, lastUsed: { lastUsed: -1 } };
  const options = { limit, sort: sortMap[sort] || { created_at: -1 } };

  const [workoutPlans, total] = await Promise.all([
    workoutDao.getUserPlans(userId, options),
    workoutDao.countUserPlans(userId),
  ]);

  return Format.success({
    workoutPlans,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

module.exports.getWorkoutPlanById = async (userId, planId) => {
  const plan = await workoutDao.findPlanByIdAndUser(planId, userId);
  if (!plan) return Format.notFound('Workout plan not found');
  await plan.markAsUsed();
  return Format.success({ workoutPlan: plan });
};

module.exports.deleteWorkoutPlan = async (userId, planId) => {
  const plan = await workoutDao.deletePlanByIdAndUser(planId, userId);
  if (!plan) return Format.notFound('Workout plan not found');
  return Format.success(null, 'Workout plan deleted successfully');
};

module.exports.setActivePlan = async (userId, planId) => {
  const plan = await workoutDao.findPlanByIdAndUser(planId, userId);
  if (!plan) return Format.notFound('Workout plan not found');
  await plan.setAsActive();
  return Format.success({ workoutPlan: plan }, 'Workout plan set as active successfully');
};

module.exports.createCustomWorkout = async (userId, { name, exercises }) => {
  if (typeof name !== 'string' || !name.trim()) return Format.badRequest('Workout name is required');
  if (!Array.isArray(exercises) || !exercises.length) return Format.badRequest('At least one exercise is required');

  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    if (!ex || typeof ex !== 'object' || typeof ex.name !== 'string' || !ex.name.trim()) {
      return Format.badRequest(`Exercise ${i + 1} name is required`);
    }
  }

  const payload = {
    userId,
    name: name.trim(),
    goal: 'Custom Workout',
    duration_per_day_minutes: calcWorkoutDuration(exercises),
    preference: ['Custom'],
    days: [{
      day: 'Custom Workout',
      workout_type: 'Custom Exercise Plan',
      estimated_calories_burned: exercises.reduce((t, ex) => t + calcExerciseCalories(ex), 0),
      exercises: exercises.map((ex) => {
        const e = {
          name: ex.name.trim(),
          type: ex.type || 'Custom',
          rest_between_sets_seconds: ex.rest || 60,
          description: ex.description || `Custom exercise: ${ex.name}`,
          calories_burned: calcExerciseCalories(ex),
        };
        if (parseInt(ex.sets) > 0) e.sets = parseInt(ex.sets);
        if (parseInt(ex.reps) > 0) e.reps = parseInt(ex.reps);
        if (parseInt(ex.duration) > 0) e.duration_minutes = parseInt(ex.duration);
        return e;
      }),
    }],
    isAIGenerated: false,
    isCustom: true,
  };

  const saved = await workoutDao.createPlan(payload);
  return Format.created({ workoutPlan: saved }, 'Custom workout created successfully');
};

const durationStats = (user) => {
  const totalSeconds = userTotalSeconds(user);
  const averageSeconds = userAverageSeconds(user);
  return {
    totalWorkoutTimeSeconds: totalSeconds,
    averageWorkoutTimeSeconds: averageSeconds,
    // Legacy minute fields, derived from seconds (no rounding to whole minutes).
    totalWorkoutTimeMinutes: secondsToMinutes(totalSeconds),
    averageWorkoutTimeMinutes: secondsToMinutes(averageSeconds),
  };
};

// Query params for history reads. Dates are ISO strings (or epoch ms); `from` is inclusive, `to` exclusive.
const parseDateParam = (value) => {
  if (value === undefined || value === null || value === '') return { ok: true, date: undefined };
  const date = /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, date };
};

const parseRange = (query = {}) => {
  const from = parseDateParam(query.from);
  const to = parseDateParam(query.to);
  if (!from.ok) return { error: '`from` must be a valid date' };
  if (!to.ok) return { error: '`to` must be a valid date' };
  if (from.date && to.date && from.date >= to.date) return { error: '`from` must be before `to`' };
  return { range: { from: from.date, to: to.date } };
};

const completionStatistics = (user) => ({
  totalWorkouts: user.totalWorkouts || 0,
  totalCaloriesBurned: user.totalCaloriesBurned || 0,
  ...durationStats(user),
});

// POST /workouts/complete. Idempotent per (user, clientSessionId); see workout.recorder.js for the write
// protocol and its failure model. `idempotencyKey` is the Idempotency-Key request header, if any.
module.exports.completeWorkout = async (userId, body, { idempotencyKey } = {}) => {
  const { workoutId, caloriesBurned, completedExercises, workoutName } = body || {};

  const durationSeconds = resolveDurationSeconds(body);
  if (durationSeconds === null) return Format.badRequest('A valid workout duration in seconds is required');

  const calories = caloriesBurned === undefined || caloriesBurned === null || caloriesBurned === '' ? NaN : Number(caloriesBurned);
  if (!Number.isFinite(calories) || calories < 0) return Format.badRequest('A valid calories burned value is required');

  if (workoutId !== undefined && workoutId !== null && workoutId !== '' && !mongoose.isValidObjectId(workoutId)) {
    return Format.badRequest('Invalid workout id');
  }
  if (completedExercises !== undefined && completedExercises !== null && !Array.isArray(completedExercises)) {
    return Format.badRequest('Completed exercises must be a list');
  }
  const { key: clientSessionId, error: keyError } = recorder.resolveClientSessionId(body?.clientSessionId, idempotencyKey);
  if (keyError) return Format.badRequest(keyError);

  const exercises = (completedExercises || [])
    .filter((ex) => ex && typeof ex === 'object')
    .map((ex) => {
      const item = { name: String(ex.name ?? 'Unknown Exercise'), completed: ex.completed === true, caloriesBurned: Math.max(Number(ex.caloriesBurned) || 0, 0) };
      // Set counts let a partially finished exercise be told apart from a finished one.
      if (Number.isInteger(ex.completedSets) && ex.completedSets >= 0) item.completedSets = ex.completedSets;
      if (Number.isInteger(ex.totalSets) && ex.totalSets >= 0) item.totalSets = ex.totalSets;
      return item;
    });

  const result = await recorder.recordCompletion(userId, {
    durationSeconds,
    caloriesBurned: Math.round(calories),
    workoutId: workoutId || null,
    workoutName: typeof workoutName === 'string' && workoutName.trim() ? workoutName.trim() : 'Custom Workout',
    exercises,
  }, clientSessionId);

  if (result.status === 'no-user') return Format.notFound('User not found');
  if (result.status === 'conflict') return Format.conflict(recorder.MESSAGES.conflict);

  const { session, user } = result;
  const duplicate = result.status === 'duplicate';
  return Format.success({
    statistics: completionStatistics(user),
    workout: {
      sessionId: String(session._id),
      durationSeconds: entrySeconds(session),
      caloriesBurned: session.caloriesBurned,
      workoutName: session.workoutName,
      completedAt: session.completedAt,
    },
    clientSessionId: session.clientSessionId || null,
    duplicate,
  }, duplicate ? 'Workout already recorded' : 'Workout completed successfully');
};

const HISTORY_DEFAULT_LIMIT = 1000;
const HISTORY_MAX_LIMIT = 5000;

// `?include=history` adds history (oldest first) for the analytics charts, so they are built from the
// same response as the totals. It comes from the complete store and is bounded: the newest
// `historyLimit` sessions (default 1000, max 5000) within the optional `from`/`to` range.
// `historyInfo.truncated` says whether older sessions in that range were left out.
module.exports.getWorkoutStatistics = async (userId, query = {}) => {
  const wantsHistory = query?.include === 'history';
  let range = {};
  let historyLimit = HISTORY_DEFAULT_LIMIT;
  if (wantsHistory) {
    const parsed = parseRange(query);
    if (parsed.error) return Format.badRequest(parsed.error);
    range = parsed.range;
    historyLimit = parseIntParam(query.historyLimit, HISTORY_DEFAULT_LIMIT, 1, HISTORY_MAX_LIMIT);
    if (historyLimit === null) return Format.badRequest('`historyLimit` must be a positive integer');
  }

  const user = await recorder.loadUserForRead(userId);
  if (!user) return Format.notFound('User not found');

  const recent = await history.getHistoryPage(userId, user, { order: 'desc', offset: 0, limit: 5 });
  const statistics = {
    ...completionStatistics(user),
    recentWorkouts: recent.items.map(history.toHistoryEntry),
  };
  if (wantsHistory) {
    const { items, total } = await history.getHistoryPage(userId, user, { range, order: 'desc', offset: 0, limit: historyLimit });
    statistics.history = items.reverse().map(history.toHistoryEntry);
    statistics.historyInfo = {
      from: range.from || null,
      to: range.to || null,
      limit: historyLimit,
      returned: items.length,
      total,
      truncated: total > items.length,
    };
  }

  return Format.success({ statistics });
};

const PAGE_DEFAULT_LIMIT = 20;
const PAGE_MAX_LIMIT = 100;

// Paginated complete history: GET /workouts/history?page=1&limit=20&order=desc|asc&from=&to=
module.exports.getWorkoutHistory = async (userId, query = {}) => {
  const parsed = parseRange(query || {});
  if (parsed.error) return Format.badRequest(parsed.error);
  const page = parseIntParam(query?.page, 1, 1, Number.MAX_SAFE_INTEGER);
  if (page === null) return Format.badRequest('`page` must be a positive integer');
  const limit = parseIntParam(query?.limit, PAGE_DEFAULT_LIMIT, 1, PAGE_MAX_LIMIT);
  if (limit === null) return Format.badRequest('`limit` must be a positive integer');
  const order = query?.order === undefined || query?.order === '' ? 'desc' : query.order;
  if (order !== 'asc' && order !== 'desc') return Format.badRequest('`order` must be asc or desc');

  const user = await recorder.loadUserForRead(userId);
  if (!user) return Format.notFound('User not found');

  const { items, total } = await history.getHistoryPage(userId, user, { range: parsed.range, order, offset: (page - 1) * limit, limit });
  const totalPages = Math.ceil(total / limit);
  return Format.success({
    sessions: items.map(history.toHistoryEntry),
    pagination: { total, page, limit, totalPages, hasMore: page < totalPages, order, from: parsed.range.from || null, to: parsed.range.to || null },
  });
};

// IANA time zone sent by the client (e.g. "Europe/Berlin"); undefined (= server zone) when missing or invalid.
const resolveTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return timeZone.trim();
  } catch {
    return undefined;
  }
};

// Calendar-day key "YYYY-MM-DD" of an instant as seen in `timeZone`.
const dayKeyFormatter = (timeZone) => {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (date) => {
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
};

// Pure calendar arithmetic on day keys (no clock or zone involved).
const keyToUtcDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDaysToKey = (key, days) => { const d = keyToUtcDate(key); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// Days are bucketed by the calendar date the user saw when finishing the workout (client time zone),
// weeks run Monday to Sunday.
module.exports.getWeeklySummary = async (userId, query = {}, now = new Date()) => {
  const user = await recorder.loadUserForRead(userId);
  if (!user) return Format.notFound('User not found');

  const timeZone = resolveTimeZone(query?.tz);
  const dayKey = dayKeyFormatter(timeZone);

  const today = dayKey(now);
  const thisMonday = addDaysToKey(today, -((keyToUtcDate(today).getUTCDay() + 6) % 7));
  const thisWeekKeys = Array.from({ length: 7 }, (_, i) => addDaysToKey(thisMonday, i));
  const lastWeekKeys = new Set(Array.from({ length: 7 }, (_, i) => addDaysToKey(thisMonday, i - 7)));

  const withMinutes = (o) => ({ ...o, minutes: secondsToMinutes(o.seconds) });
  const add = (acc, w) => { acc.workouts += 1; acc.seconds += entrySeconds(w); acc.calories += Number(w.caloriesBurned) || 0; return acc; };
  const empty = () => ({ workouts: 0, seconds: 0, calories: 0 });

  const dailyMap = new Map(thisWeekKeys.map((key) => [key, { date: key, ...empty() }]));
  const lastWeekTotals = empty();

  // Fetch the two weeks with a 2-day margin on each side (covers every UTC offset); the day keys below
  // decide which bucket, if any, a session belongs to.
  const lastMonday = addDaysToKey(thisMonday, -7);
  const range = { from: new Date(keyToUtcDate(lastMonday).getTime() - 2 * 86400000), to: new Date(keyToUtcDate(thisMonday).getTime() + 9 * 86400000) };
  const sessions = await history.getAllInRange(userId, user, range);
  for (const w of sessions) {
    const completedAt = new Date(w?.completedAt);
    if (!w?.completedAt || Number.isNaN(completedAt.getTime())) continue;
    const key = dayKey(completedAt);
    if (dailyMap.has(key)) add(dailyMap.get(key), w);
    else if (lastWeekKeys.has(key)) add(lastWeekTotals, w);
  }

  const daily = Array.from(dailyMap.values());
  const thisWeek = withMinutes(daily.reduce((acc, d) => ({ workouts: acc.workouts + d.workouts, seconds: acc.seconds + d.seconds, calories: acc.calories + d.calories }), empty()));
  const lastWeek = withMinutes(lastWeekTotals);
  const delta = withMinutes({ workouts: thisWeek.workouts - lastWeek.workouts, seconds: thisWeek.seconds - lastWeek.seconds, calories: thisWeek.calories - lastWeek.calories });

  return Format.success({ thisWeek, lastWeek, delta, today, daily: daily.map(withMinutes) });
};
