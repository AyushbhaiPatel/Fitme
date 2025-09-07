const { Format } = require('../../config/format');
const workoutDao = require('./workout.dao');
const { generateContent, isAvailable } = require('../../config/gemini');

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

const buildPrompt = (userData, numberOfDays, duration, customOptions = {}) => {
  const dayLabels = Array.from({ length: numberOfDays }, (_, i) => `Day ${i + 1}`);
  const { focusArea = '', intensity = '', equipment = '', specificGoals = '' } = customOptions;

  return `You are an expert fitness trainer. Create a personalized ${numberOfDays}-day workout plan.

USER PROFILE:
- Primary Goal: ${userData.goal}
- Experience: ${userData.fitnessExperience}
- Preferred Workouts: ${userData.preferredWorkouts.join(', ') || 'varied'}
- Frequency: ${userData.workoutFrequency} times/week
- Session Duration: ${duration} minutes
- Height: ${userData.height || 'N/A'} cm, Weight: ${userData.weight || 'N/A'} kg
- Age: ${userData.age || 'N/A'}, Gender: ${userData.gender || 'N/A'}
${focusArea ? `- Focus Area: ${focusArea}` : ''}${intensity ? `\n- Intensity: ${intensity}` : ''}${equipment ? `\n- Equipment: ${equipment}` : ''}${specificGoals ? `\n- Special Instructions: ${specificGoals}` : ''}

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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  let jsonText = jsonMatch[0]
    .replace(/"reps":\s*"([^"]+)"/g, (_, v) => {
      if (v.includes('-')) {
        const [a, b] = v.split('-');
        return `"reps": ${Math.round((parseInt(a) + parseInt(b)) / 2)}`;
      }
      const n = parseInt(v);
      return `"reps": ${isNaN(n) ? 'null' : n}`;
    })
    .replace(/"sets":\s*"(\d+)"/g, (_, v) => `"sets": ${parseInt(v)}`)
    .replace(/"calories_burned":\s*"(\d+)"/g, (_, v) => `"calories_burned": ${parseInt(v)}`)
    .replace(/"estimated_calories_burned":\s*"(\d+)"/g, (_, v) => `"estimated_calories_burned": ${parseInt(v)}`);

  const plan = JSON.parse(jsonText);
  if (!plan.days || !Array.isArray(plan.days)) throw new Error('Invalid plan structure');

  plan.days = plan.days.map((day, i) => ({
    day: day.day || `Day ${i + 1}`,
    workout_type: day.workout_type || 'Mixed Training',
    estimated_calories_burned: typeof day.estimated_calories_burned === 'number' ? day.estimated_calories_burned : 300,
    exercises: (day.exercises || []).map((ex) => ({
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
  }));

  return plan;
};

const getDemoPlan = (userData, numberOfDays, duration) => {
  const types = ['Full Body Strength', 'Cardio & Core', 'Upper & Lower Body', 'Lower Body', 'Active Recovery', 'Push Day', 'Pull Day'];
  const demoExercises = [
    { name: 'Push-ups', type: 'Strength', sets: 3, reps: 12, rest_between_sets_seconds: 60, calories_burned: 50, description: 'Standard push-ups from plank position.' },
    { name: 'Bodyweight Squats', type: 'Strength', sets: 3, reps: 15, rest_between_sets_seconds: 60, calories_burned: 60, description: 'Squat with feet shoulder-width apart.' },
    { name: 'Plank Hold', type: 'Core', sets: 3, reps: null, duration_seconds: 30, rest_between_sets_seconds: 45, calories_burned: 40, description: 'Hold plank on forearms.' },
  ];
  return {
    name: `Demo ${numberOfDays}-Day Plan`,
    goal: mapGoal(userData.goal),
    duration_per_day_minutes: duration,
    preference: userData.preferredWorkouts.length > 0 ? userData.preferredWorkouts : ['Mixed Training'],
    frequency: userData.workoutFrequency,
    days: Array.from({ length: numberOfDays }, (_, i) => ({
      day: `Day ${i + 1}`,
      workout_type: types[i % types.length],
      estimated_calories_burned: 250,
      exercises: demoExercises,
    })),
  };
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

// Service functions

module.exports.generateWorkoutPlan = async (userId, body) => {
  const user = await workoutDao.findUserById(userId);
  if (!user) return Format.notFound('User not found');

  const customOptions = body.customOptions || null;
  const userData = {
    goal: user.fitnessGoals?.[0] || 'general-fitness',
    weight: user.weight,
    height: user.height,
    age: calculateAge(user.dateOfBirth),
    gender: user.gender,
    fitnessExperience: body.fitnessExperience || user.fitnessExperience || 'beginner',
    preferredWorkouts: user.preferredWorkouts ? user.preferredWorkouts.split(',').map((s) => s.trim()) : [],
    workoutFrequency: body.workoutFrequency || user.workoutFrequency || '3-4',
    workoutDuration: body.workoutDuration || user.workoutDuration || '30-45',
  };

  const numberOfDays = getWorkoutDays(userData.workoutFrequency);
  const duration = parseInt(userData.workoutDuration?.split('-')[1]) || 45;

  if (!isAvailable()) {
    return Format.success({ workoutPlan: getDemoPlan(userData, numberOfDays, duration), isDemoMode: true }, 'Demo workout plan (AI unavailable)');
  }

  try {
    const raw = await generateContent(buildPrompt(userData, numberOfDays, duration, customOptions));
    const workoutPlan = parseWorkoutResponse(raw);
    return Format.success({ workoutPlan, isAIGenerated: true, isDemoMode: false });
  } catch (err) {
    console.error('Gemini workout generation failed:', err.message);
    return Format.success({ workoutPlan: getDemoPlan(userData, numberOfDays, duration), isDemoMode: true }, 'Demo workout plan (AI generation failed)');
  }
};

module.exports.saveWorkoutPlan = async (userId, { workoutPlan, name }) => {
  if (!workoutPlan) return Format.badRequest('Workout plan data is required');
  if (!name?.trim()) return Format.badRequest('Workout plan name is required');
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
  const { page = 1, limit = 10, sort = 'createdAt' } = query;
  const sortMap = { name: { name: 1 }, lastUsed: { lastUsed: -1 } };
  const options = { limit: parseInt(limit), sort: sortMap[sort] || { created_at: -1 } };

  const [workoutPlans, total] = await Promise.all([
    workoutDao.getUserPlans(userId, options),
    workoutDao.countUserPlans(userId),
  ]);

  return Format.success({
    workoutPlans,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
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
  if (!name?.trim()) return Format.badRequest('Workout name is required');
  if (!exercises?.length) return Format.badRequest('At least one exercise is required');

  for (let i = 0; i < exercises.length; i++) {
    if (!exercises[i].name?.trim()) return Format.badRequest(`Exercise ${i + 1} name is required`);
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

module.exports.completeWorkout = async (userId, { workoutId, caloriesBurned, durationMinutes, completedExercises, workoutName }) => {
  if (!caloriesBurned || !durationMinutes) return Format.badRequest('Calories burned and workout duration are required');

  const user = await workoutDao.findUserById(userId);
  if (!user) return Format.notFound('User not found');

  user.totalWorkouts += 1;
  user.totalCaloriesBurned += parseInt(caloriesBurned);
  user.totalWorkoutTimeMinutes += parseInt(durationMinutes);
  user.averageWorkoutTimeMinutes = Math.round(user.totalWorkoutTimeMinutes / user.totalWorkouts);
  user.workoutHistory.push({
    workoutId: workoutId || null,
    completedAt: new Date(),
    caloriesBurned: parseInt(caloriesBurned),
    durationMinutes: parseInt(durationMinutes),
    workoutName: workoutName || 'Custom Workout',
    exercises: completedExercises || [],
  });
  if (user.workoutHistory.length > 50) user.workoutHistory = user.workoutHistory.slice(-50);
  await workoutDao.saveUser(user);

  return Format.success({
    statistics: {
      totalWorkouts: user.totalWorkouts,
      totalCaloriesBurned: user.totalCaloriesBurned,
      averageWorkoutTimeMinutes: user.averageWorkoutTimeMinutes,
      totalWorkoutTimeMinutes: user.totalWorkoutTimeMinutes,
    },
  }, 'Workout completed successfully');
};

module.exports.getWorkoutStatistics = async (userId) => {
  const user = await workoutDao.findUserById(userId);
  if (!user) return Format.notFound('User not found');

  return Format.success({
    statistics: {
      totalWorkouts: user.totalWorkouts || 0,
      totalCaloriesBurned: user.totalCaloriesBurned || 0,
      averageWorkoutTimeMinutes: user.averageWorkoutTimeMinutes || 0,
      totalWorkoutTimeMinutes: user.totalWorkoutTimeMinutes || 0,
      recentWorkouts: (user.workoutHistory || []).slice(-5).reverse(),
    },
  });
};

module.exports.getWeeklySummary = async (userId) => {
  const user = await workoutDao.findUserById(userId);
  if (!user) return Format.notFound('User not found');

  const toStartOfDay = (d) => { const nd = new Date(d); nd.setHours(0, 0, 0, 0); return nd; };
  const startOfWeek = (d) => {
    const nd = toStartOfDay(d);
    nd.setDate(nd.getDate() - ((nd.getDay() + 6) % 7));
    return nd;
  };

  const thisWeekStart = startOfWeek(new Date());
  const nextWeekStart = new Date(thisWeekStart); nextWeekStart.setDate(thisWeekStart.getDate() + 7);
  const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  const inRange = (date, start, end) => { const t = new Date(date).getTime(); return t >= start.getTime() && t < end.getTime(); };
  const aggregate = (entries) => entries.reduce((acc, w) => ({ workouts: acc.workouts + 1, minutes: acc.minutes + parseInt(w.durationMinutes || 0), calories: acc.calories + parseInt(w.caloriesBurned || 0) }), { workouts: 0, minutes: 0, calories: 0 });

  const history = Array.isArray(user.workoutHistory) ? user.workoutHistory : [];
  const thisWeekEntries = history.filter((w) => inRange(w.completedAt, thisWeekStart, nextWeekStart));
  const lastWeekEntries = history.filter((w) => inRange(w.completedAt, lastWeekStart, thisWeekStart));

  const thisWeek = aggregate(thisWeekEntries);
  const lastWeek = aggregate(lastWeekEntries);
  const delta = { workouts: thisWeek.workouts - lastWeek.workouts, minutes: thisWeek.minutes - lastWeek.minutes, calories: thisWeek.calories - lastWeek.calories };

  const dailyMap = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(thisWeekStart); d.setDate(thisWeekStart.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, { date: key, workouts: 0, minutes: 0, calories: 0 });
  }
  for (const w of thisWeekEntries) {
    const key = toStartOfDay(new Date(w.completedAt)).toISOString().slice(0, 10);
    if (!dailyMap.has(key)) continue;
    const obj = dailyMap.get(key);
    obj.workouts += 1; obj.minutes += parseInt(w.durationMinutes || 0); obj.calories += parseInt(w.caloriesBurned || 0);
  }

  return Format.success({ thisWeek, lastWeek, delta, daily: Array.from(dailyMap.values()) });
};
