const User = require('../models/User');
const WorkoutPlan = require('../models/WorkoutPlan');
const { generateContent, isAvailable } = require('../services/geminiClient');

const generateWorkoutPlan = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Merge profile from DB with any overrides from request body
    const body = req.body || {};
    const customOptions = body.customOptions || null;
    const userData = {
      goal: user.fitnessGoals?.[0] || 'general-fitness',
      weight: user.weight,
      height: user.height,
      age: calculateAge(user.dateOfBirth),
      gender: user.gender,
      fitnessExperience: body.fitnessExperience || user.fitnessExperience || 'beginner',
      preferredWorkouts: user.preferredWorkouts ? user.preferredWorkouts.split(',').map(s => s.trim()) : [],
      dietaryPreference: user.dietaryPreference || 'none',
      workoutFrequency: body.workoutFrequency || user.workoutFrequency || '3-4',
      workoutDuration: body.workoutDuration || user.workoutDuration || '30-45',
    };

    const getWorkoutDays = (freq) => ({ '2-3': 3, '3-4': 4, '4-5': 5, '5-6': 6, 'daily': 7 }[freq] || 3);
    const numberOfDays = getWorkoutDays(userData.workoutFrequency);
    const duration = parseInt(userData.workoutDuration?.split('-')[1]) || 45;

    if (!isAvailable()) {
      return res.json({
        success: true,
        workoutPlan: getDemoWorkoutPlan(userData, numberOfDays, duration),
        message: 'Demo workout plan (AI unavailable)',
        isDemoMode: true,
      });
    }

    try {
      const prompt = buildWorkoutPrompt(userData, numberOfDays, duration, customOptions);
      const raw = await generateContent(prompt);
      const workoutPlan = parseWorkoutResponse(raw, numberOfDays);

      return res.json({ success: true, workoutPlan, isAIGenerated: true, isDemoMode: false });
    } catch (aiErr) {
      console.error('Gemini workout generation failed, using demo:', aiErr.message);
      return res.json({
        success: true,
        workoutPlan: getDemoWorkoutPlan(userData, numberOfDays, duration),
        message: 'Demo workout plan (AI generation failed)',
        isDemoMode: true,
      });
    }
  } catch (error) {
    console.error('Workout generation error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate workout plan',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const buildWorkoutPrompt = (userData, numberOfDays, duration, customOptions) => {
  const dayLabels = Array.from({ length: numberOfDays }, (_, i) => `Day ${i + 1}`);
  const focusArea = customOptions?.focusArea || '';
  const intensity = customOptions?.intensity || '';
  const equipment = customOptions?.equipment || '';
  const specificGoals = customOptions?.specificGoals || '';

  return `You are an expert fitness trainer. Create a personalized ${numberOfDays}-day workout plan.

USER PROFILE:
- Primary Goal: ${userData.goal}
- Activity Level: moderately-active
- Experience: ${userData.fitnessExperience}
- Preferred Workouts: ${userData.preferredWorkouts.join(', ') || 'varied'}
- Frequency: ${userData.workoutFrequency} times/week
- Session Duration: ${duration} minutes
- Height: ${userData.height || 'N/A'} cm, Weight: ${userData.weight || 'N/A'} kg
- Age: ${userData.age || 'N/A'}, Gender: ${userData.gender || 'N/A'}
${focusArea ? `- Focus Area: ${focusArea}` : ''}
${intensity ? `- Intensity: ${intensity}` : ''}
${equipment ? `- Equipment: ${equipment}` : ''}
${specificGoals ? `- Special Instructions: ${specificGoals}` : ''}

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

const parseWorkoutResponse = (text, expectedDays) => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  let jsonText = jsonMatch[0];
  // Fix common issues
  jsonText = jsonText.replace(/"reps":\s*"([^"]+)"/g, (_, v) => {
    if (v.includes('-')) {
      const parts = v.split('-');
      return `"reps": ${Math.round((parseInt(parts[0]) + parseInt(parts[1])) / 2)}`;
    }
    const n = parseInt(v);
    return `"reps": ${isNaN(n) ? 'null' : n}`;
  });
  jsonText = jsonText.replace(/"sets":\s*"(\d+)"/g, (_, v) => `"sets": ${parseInt(v)}`);
  jsonText = jsonText.replace(/"calories_burned":\s*"(\d+)"/g, (_, v) => `"calories_burned": ${parseInt(v)}`);
  jsonText = jsonText.replace(/"estimated_calories_burned":\s*"(\d+)"/g, (_, v) => `"estimated_calories_burned": ${parseInt(v)}`);

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

const getDemoWorkoutPlan = (userData, numberOfDays, duration) => {
  const days = [];
  const types = numberOfDays <= 3
    ? ['Full Body Strength', 'Cardio & Core', 'Upper & Lower Body']
    : ['Upper Body', 'Lower Body', 'Cardio & Core', 'Full Body Circuit', 'Active Recovery', 'Push Day', 'Pull Day'];

  const demoExercises = [
    { name: 'Push-ups', type: 'Strength', sets: 3, reps: 12, rest_between_sets_seconds: 60, calories_burned: 50, description: 'Standard push-ups from plank position.' },
    { name: 'Bodyweight Squats', type: 'Strength', sets: 3, reps: 15, rest_between_sets_seconds: 60, calories_burned: 60, description: 'Squat with feet shoulder-width apart.' },
    { name: 'Plank Hold', type: 'Core', sets: 3, reps: null, duration_seconds: 30, rest_between_sets_seconds: 45, calories_burned: 40, description: 'Hold plank on forearms.' },
  ];

  for (let i = 0; i < numberOfDays; i++) {
    days.push({
      day: `Day ${i + 1}`,
      workout_type: types[i % types.length],
      estimated_calories_burned: 250,
      exercises: demoExercises,
    });
  }

  return {
    name: `Demo ${numberOfDays}-Day Plan`,
    goal: mapGoalToDescription(userData.goal),
    duration_per_day_minutes: duration,
    preference: userData.preferredWorkouts.length > 0 ? userData.preferredWorkouts : ['Mixed Training'],
    frequency: userData.workoutFrequency,
    days,
  };
};

const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return 25; // Default age if not provided
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

const mapGoalToDescription = (goal) => {
  const goalMap = {
    'weight-loss': 'Weight Loss',
    'weight-gain': 'Weight Gain',
    'muscle-gain': 'Muscle Building',
    'strength': 'Strength Training',
    'general-fitness': 'General Fitness'
  };
  return goalMap[goal] || 'General Fitness';
};

const saveWorkoutPlan = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { workoutPlan, name } = req.body;

    console.log('Received workout plan data:', JSON.stringify({ workoutPlan, name }, null, 2));

    if (!workoutPlan) {
      return res.status(400).json({
        success: false,
        message: 'Workout plan data is required'
      });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Workout plan name is required'
      });
    }

    // Validate workout plan structure
    if (!workoutPlan.goal) {
      return res.status(400).json({
        success: false,
        message: 'Workout plan goal is required'
      });
    }

    // Validate days array
    if (workoutPlan.days && workoutPlan.days.length > 0) {
      for (let i = 0; i < workoutPlan.days.length; i++) {
        const day = workoutPlan.days[i];
        if (!day.day) {
          return res.status(400).json({
            success: false,
            message: `Day field is required for day ${i + 1}`
          });
        }
        if (!day.workout_type) {
          return res.status(400).json({
            success: false,
            message: `Workout type is required for day ${i + 1}`
          });
        }
        
        // Validate exercises
        if (day.exercises && day.exercises.length > 0) {
          for (let j = 0; j < day.exercises.length; j++) {
            const exercise = day.exercises[j];
            if (!exercise.name) {
              return res.status(400).json({
                success: false,
                message: `Exercise name is required for exercise ${j + 1} on day ${i + 1}`
              });
            }
            if (!exercise.type) {
              return res.status(400).json({
                success: false,
                message: `Exercise type is required for exercise ${j + 1} on day ${i + 1}`
              });
            }
          }
        }
      }
    }

    // Create new workout plan
    const newWorkoutPlan = new WorkoutPlan({
      userId,
      name: name.trim(),
      goal: workoutPlan.goal,
      duration_per_day_minutes: workoutPlan.duration_per_day_minutes,
      preference: workoutPlan.preference || [],
      days: workoutPlan.days || [],
      isAIGenerated: workoutPlan.isAIGenerated || false
    });

    console.log('About to save workout plan:', JSON.stringify(newWorkoutPlan.toObject(), null, 2));

    const savedPlan = await newWorkoutPlan.save();

    res.json({
      success: true,
      message: 'Workout plan saved successfully',
      workoutPlan: savedPlan
    });

  } catch (error) {
    console.error('Error saving workout plan:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to save workout plan',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const getSavedWorkoutPlans = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { page = 1, limit = 10, sort = 'createdAt' } = req.query;

    const options = {
      limit: parseInt(limit),
      sort: {}
    };

    // Set sort options
    if (sort === 'name') {
      options.sort = { name: 1 };
    } else if (sort === 'lastUsed') {
      options.sort = { lastUsed: -1 };
    } else {
      options.sort = { createdAt: -1 };
    }

    const workoutPlans = await WorkoutPlan.getUserPlans(userId, options);
    const total = await WorkoutPlan.countDocuments({ userId });

    res.json({
      success: true,
      workoutPlans,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching saved workout plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch saved workout plans',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const getWorkoutPlanById = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { planId } = req.params;

    const workoutPlan = await WorkoutPlan.findOne({ _id: planId, userId });

    if (!workoutPlan) {
      return res.status(404).json({
        success: false,
        message: 'Workout plan not found'
      });
    }

    // Mark as used
    await workoutPlan.markAsUsed();

    res.json({
      success: true,
      workoutPlan
    });

  } catch (error) {
    console.error('Error fetching workout plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workout plan',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const deleteWorkoutPlan = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { planId } = req.params;

    const workoutPlan = await WorkoutPlan.findOneAndDelete({ _id: planId, userId });

    if (!workoutPlan) {
      return res.status(404).json({
        success: false,
        message: 'Workout plan not found'
      });
    }

    res.json({
      success: true,
      message: 'Workout plan deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting workout plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete workout plan',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const setActivePlan = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { planId } = req.params;

    const workoutPlan = await WorkoutPlan.findOne({ _id: planId, userId });

    if (!workoutPlan) {
      return res.status(404).json({
        success: false,
        message: 'Workout plan not found'
      });
    }

    await workoutPlan.setAsActive();

    res.json({
      success: true,
      message: 'Workout plan set as active successfully',
      workoutPlan
    });

  } catch (error) {
    console.error('Error setting active workout plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set active workout plan',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const createCustomWorkout = async (req, res) => {
  try {
    console.log('=== Custom Workout Creation Debug ===');
    console.log('Request user:', req.user ? 'Present' : 'Missing');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const userId = req.user._id || req.user.id;
    console.log('User ID:', userId);
    
    const { name, exercises } = req.body;

    if (!name || name.trim().length === 0) {
      console.log('❌ Validation failed: Missing workout name');
      return res.status(400).json({
        success: false,
        message: 'Workout name is required'
      });
    }

    if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
      console.log('❌ Validation failed: Missing or invalid exercises');
      return res.status(400).json({
        success: false,
        message: 'At least one exercise is required'
      });
    }

    // Validate exercises
    console.log('Validating exercises...');
    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];
      console.log(`Exercise ${i + 1}:`, exercise);
      if (!exercise.name || exercise.name.trim().length === 0) {
        console.log(`❌ Validation failed: Exercise ${i + 1} missing name`);
        return res.status(400).json({
          success: false,
          message: `Exercise ${i + 1} name is required`
        });
      }
    }

    // Convert the custom workout format to our workout plan format
    const customWorkoutPlan = {
      userId,
      name: name.trim(),
      goal: 'Custom Workout',
      duration_per_day_minutes: calculateWorkoutDuration(exercises),
      preference: ['Custom'],
      days: [{
        day: "Custom Workout",
        workout_type: "Custom Exercise Plan",
        estimated_calories_burned: calculateTotalCalories(exercises),
        exercises: exercises.map(exercise => {
          const processedExercise = {
            name: exercise.name.trim(),
            type: exercise.type || 'Custom',
            rest_between_sets_seconds: exercise.rest || 60,
            description: exercise.description || `Custom exercise: ${exercise.name}`,
            calories_burned: calculateExerciseCalories(exercise)
          };
          
          // Only add sets/reps if they are provided and valid
          if (exercise.sets && parseInt(exercise.sets) > 0) {
            processedExercise.sets = parseInt(exercise.sets);
          }
          if (exercise.reps && parseInt(exercise.reps) > 0) {
            processedExercise.reps = parseInt(exercise.reps);
          }
          
          // Only add duration if provided and valid
          if (exercise.duration && parseInt(exercise.duration) > 0) {
            processedExercise.duration_minutes = parseInt(exercise.duration);
          }
          
          return processedExercise;
        })
      }],
      isAIGenerated: false,
      isCustom: true
    };

    console.log('Creating workout plan with data:', JSON.stringify(customWorkoutPlan, null, 2));
    
    const newWorkoutPlan = new WorkoutPlan(customWorkoutPlan);
    console.log('Saving workout plan to database...');
    
    const savedPlan = await newWorkoutPlan.save();
    console.log('✅ Workout plan saved successfully:', savedPlan._id);

    res.json({
      success: true,
      message: 'Custom workout created successfully',
      workoutPlan: savedPlan
    });

  } catch (error) {
    console.error('❌ Error creating custom workout:', error.message);
    console.error('Error stack:', error.stack);
    
    // Handle specific MongoDB errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Validation error'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create custom workout',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Helper function to calculate workout duration
const calculateWorkoutDuration = (exercises) => {
  let totalMinutes = 0;
  exercises.forEach(exercise => {
    if (exercise.duration) {
      totalMinutes += parseInt(exercise.duration) || 0;
    } else if (exercise.sets && exercise.reps) {
      // Estimate time: 30 seconds per set + rest time
      const sets = parseInt(exercise.sets) || 1;
      const restTime = (exercise.rest || 60) * sets / 60; // Convert to minutes
      totalMinutes += (sets * 0.5) + restTime; // 30 seconds per set + rest
    } else {
      totalMinutes += 5; // Default 5 minutes per exercise
    }
  });
  return Math.max(totalMinutes, 10); // Minimum 10 minutes
};

// Helper function to calculate total calories
const calculateTotalCalories = (exercises) => {
  let totalCalories = 0;
  exercises.forEach(exercise => {
    totalCalories += calculateExerciseCalories(exercise);
  });
  return Math.max(totalCalories, 50); // Minimum 50 calories
};

// Helper function to calculate exercise calories
const calculateExerciseCalories = (exercise) => {
  const sets = parseInt(exercise.sets) || 1;
  const reps = parseInt(exercise.reps) || 10;
  const duration = parseInt(exercise.duration) || 0;

  if (duration > 0) {
    // Duration-based exercises: ~5 calories per minute
    return duration * 5;
  } else {
    // Sets/reps based exercises: estimate based on intensity
    const totalReps = sets * reps;
    return Math.max(totalReps * 0.5, 20); // At least 20 calories per exercise
  }
};

const completeWorkout = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { workoutId, caloriesBurned, durationMinutes, completedExercises, workoutName } = req.body;

    // Validate required data
    if (!caloriesBurned || !durationMinutes) {
      return res.status(400).json({
        success: false,
        message: 'Calories burned and workout duration are required'
      });
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create workout completion entry
    const workoutCompletion = {
      workoutId: workoutId || null,
      completedAt: new Date(),
      caloriesBurned: parseInt(caloriesBurned),
      durationMinutes: parseInt(durationMinutes),
      workoutName: workoutName || 'Custom Workout',
      exercises: completedExercises || []
    };

    // Update user statistics
    user.totalWorkouts += 1;
    user.totalCaloriesBurned += parseInt(caloriesBurned);
    user.totalWorkoutTimeMinutes += parseInt(durationMinutes);
    user.averageWorkoutTimeMinutes = Math.round(user.totalWorkoutTimeMinutes / user.totalWorkouts);
    
    // Add to workout history
    user.workoutHistory.push(workoutCompletion);
    
    // Keep only last 50 workouts in history to prevent document from growing too large
    if (user.workoutHistory.length > 50) {
      user.workoutHistory = user.workoutHistory.slice(-50);
    }

    await user.save();

    res.json({
      success: true,
      message: 'Workout completed successfully',
      statistics: {
        totalWorkouts: user.totalWorkouts,
        totalCaloriesBurned: user.totalCaloriesBurned,
        averageWorkoutTimeMinutes: user.averageWorkoutTimeMinutes,
        totalWorkoutTimeMinutes: user.totalWorkoutTimeMinutes
      }
    });

  } catch (error) {
    console.error('Error completing workout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete workout',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const getWorkoutStatistics = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const statistics = {
      totalWorkouts: user.totalWorkouts || 0,
      totalCaloriesBurned: user.totalCaloriesBurned || 0,
      averageWorkoutTimeMinutes: user.averageWorkoutTimeMinutes || 0,
      totalWorkoutTimeMinutes: user.totalWorkoutTimeMinutes || 0,
      recentWorkouts: user.workoutHistory ? user.workoutHistory.slice(-5).reverse() : []
    };

    res.json({
      success: true,
      statistics
    });

  } catch (error) {
    console.error('Error fetching workout statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workout statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// GET /api/workouts/weekly-summary
// Returns per-user weekly aggregates: thisWeek, lastWeek, delta, and daily breakdown for the current week
const getWeeklySummary = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const toStartOfDay = (d) => {
      const nd = new Date(d);
      nd.setHours(0, 0, 0, 0);
      return nd;
    };

    // Monday as start of week
    const startOfWeek = (d) => {
      const nd = toStartOfDay(d);
      const day = nd.getDay(); // 0=Sun, 1=Mon, ...
      const diff = (day + 6) % 7; // days since Monday
      nd.setDate(nd.getDate() - diff);
      return nd;
    };

    const thisWeekStart = startOfWeek(new Date());
    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setDate(thisWeekStart.getDate() + 7);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart); // exclusive upper bound

    const inRange = (date, start, end) => {
      const t = new Date(date).getTime();
      return t >= start.getTime() && t < end.getTime();
    };

    const history = Array.isArray(user.workoutHistory) ? user.workoutHistory : [];

    const aggregate = (entries) => {
      const base = { workouts: 0, minutes: 0, calories: 0 };
      for (const w of entries) {
        base.workouts += 1;
        base.minutes += parseInt(w.durationMinutes || 0);
        base.calories += parseInt(w.caloriesBurned || 0);
      }
      return base;
    };

    // Collect entries
    const thisWeekEntries = history.filter(w => inRange(w.completedAt, thisWeekStart, nextWeekStart));
    const lastWeekEntries = history.filter(w => inRange(w.completedAt, lastWeekStart, lastWeekEnd));

    const thisWeek = aggregate(thisWeekEntries);
    const lastWeek = aggregate(lastWeekEntries);

    const delta = {
      workouts: thisWeek.workouts - lastWeek.workouts,
      minutes: thisWeek.minutes - lastWeek.minutes,
      calories: thisWeek.calories - lastWeek.calories
    };

    // Daily breakdown for the current week (Mon..Sun)
    const dailyMap = new Map();
    for (let i = 0; i < 7; i++) {
      const d = new Date(thisWeekStart);
      d.setDate(thisWeekStart.getDate() + i);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      dailyMap.set(key, { date: key, workouts: 0, minutes: 0, calories: 0 });
    }
    for (const w of thisWeekEntries) {
      const dayKey = toStartOfDay(new Date(w.completedAt)).toISOString().slice(0, 10);
      if (!dailyMap.has(dayKey)) continue;
      const obj = dailyMap.get(dayKey);
      obj.workouts += 1;
      obj.minutes += parseInt(w.durationMinutes || 0);
      obj.calories += parseInt(w.caloriesBurned || 0);
    }
    const daily = Array.from(dailyMap.values());

    return res.json({
      success: true,
      thisWeek,
      lastWeek,
      delta,
      daily
    });
  } catch (error) {
    console.error('Error generating weekly summary:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate weekly summary',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  generateWorkoutPlan,
  saveWorkoutPlan,
  getSavedWorkoutPlans,
  getWorkoutPlanById,
  deleteWorkoutPlan,
  setActivePlan,
  createCustomWorkout,
  completeWorkout,
  getWorkoutStatistics,
  getWeeklySummary
};