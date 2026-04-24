const { generateContent, isAvailable } = require('./geminiClient');
const MealPlan = require('../models/MealPlan');

/**
 * Parse JSON from Gemini response, stripping markdown fences
 */
const parseJSON = (text) => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
};

/**
 * Build the daily meal plan prompt
 */
const buildDailyPrompt = (profile, targetDay = 'Today') => {
  const age = profile.age || 30;
  const weight = profile.weight || 70;
  const height = profile.height || 170;
  const gender = profile.gender || 'other';
  const activity = profile.activity_level || 'moderately_active';
  const goal = profile.fitness_goal || 'maintenance';
  const dietary = (profile.dietary_preferences || []).join(', ') || 'None';
  const allergies = (profile.allergies || []).join(', ') || 'None';
  const dislikes = (profile.disliked_foods || []).join(', ') || 'None';
  const skill = profile.cooking_skill || 'intermediate';
  const cuisinePref = profile.preferred_cuisines?.length
    ? `Focus on ${profile.preferred_cuisines.join(', ')} cuisine. `
    : '';
  const mealFocus = profile.meal_focus || 'balanced';
  const maxPrep = profile.max_prep_time || 30;

  return `Create a daily meal plan with detailed nutrition information for ${targetDay} for a person with these characteristics:
- Age: ${age}, Weight: ${weight}kg, Height: ${height}cm
- Gender: ${gender}, Activity: ${activity}
- Fitness Goal: ${goal}
- Dietary Preferences: ${dietary}
- Allergies: ${allergies}
- Dislikes: ${dislikes}
- Cooking Skill: ${skill}

Preferences for this day:
- ${cuisinePref}
- Meal focus: ${mealFocus}
- Maximum prep time per meal: ${maxPrep} minutes

Return ONLY a JSON object with this exact structure:
{
  "day": "${targetDay}",
  "breakfast": {
    "name": "Meal Name",
    "description": "Brief description",
    "ingredients": [{"name": "ingredient1", "amount": "quantity with unit"}],
    "instructions": ["step1", "step2"],
    "prep_time": 15,
    "cuisine_type": "international",
    "difficulty": "beginner",
    "portion_size": "1 serving",
    "total_nutrition": {"calories": 400, "protein": 25, "carbs": 45, "fat": 12, "fiber": 5, "sugar": 8}
  },
  "lunch": { same structure },
  "dinner": { same structure },
  "daily_totals": {"calories": 1800, "protein": 120, "carbs": 200, "fat": 60, "fiber": 25, "sugar": 40}
}

Ensure all nutrition values are realistic numbers, not strings.`;
};

/**
 * Transform parsed Gemini daily response into our MealPlan-compatible shape
 */
const transformDailyResponse = (data) => {
  const transformMeal = (mealData) => {
    if (!mealData) return null;
    return {
      name: mealData.name,
      description: mealData.description || '',
      ingredients: (mealData.ingredients || []).map((i) =>
        typeof i === 'string' ? i : i.name || String(i)
      ),
      instructions: mealData.instructions || [],
      prep_time: mealData.prep_time || 0,
      nutrition: mealData.total_nutrition || null,
      cuisine_type: mealData.cuisine_type || '',
      difficulty: mealData.difficulty || 'intermediate',
      portion_size: mealData.portion_size || '1 serving',
    };
  };

  return {
    breakfast: transformMeal(data.breakfast),
    lunch: transformMeal(data.lunch),
    dinner: transformMeal(data.dinner),
    snack: data.snack ? transformMeal(data.snack) : null,
    total_calories: data.daily_totals?.calories || 0,
    total_protein: data.daily_totals?.protein || 0,
    total_carbs: data.daily_totals?.carbs || 0,
    total_fat: data.daily_totals?.fat || 0,
  };
};

/**
 * Generate a daily meal plan
 */
const generateMealPlan = async (profile, userId) => {
  if (!isAvailable()) {
    throw new Error('AI meal generation service is not available. Please check server configuration.');
  }

  const prompt = buildDailyPrompt(profile);
  const raw = await generateContent(prompt);
  const parsed = parseJSON(raw);

  // Validate required meals
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    if (!parsed[meal]) throw new Error(`Missing ${meal} in generated plan`);
  }

  const meals = transformDailyResponse(parsed);

  // Save to DB
  const plan = await MealPlan.create({
    userId,
    meals,
    preferences: {
      meal_focus: profile.meal_focus,
      cooking_skill: profile.cooking_skill,
      max_prep_time: profile.max_prep_time,
    },
  });

  return plan;
};

/**
 * Get all meal plans for a user
 */
const getUserMealPlans = async (userId, limit = 10, skip = 0) => {
  return MealPlan.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit);
};

/**
 * Get a single meal plan by ID (scoped to user)
 */
const getMealPlanById = async (planId, userId) => {
  return MealPlan.findOne({ _id: planId, userId });
};

/**
 * Delete a meal plan
 */
const deleteMealPlan = async (planId, userId) => {
  return MealPlan.findOneAndDelete({ _id: planId, userId });
};

/**
 * Regenerate a meal plan
 */
const regenerateMealPlan = async (planId, userId) => {
  const existing = await MealPlan.findOne({ _id: planId, userId });
  if (!existing) throw new Error('Meal plan not found');

  const profile = {
    ...(existing.preferences || {}),
    meal_focus: existing.preferences?.meal_focus || 'balanced',
    cooking_skill: existing.preferences?.cooking_skill || 'intermediate',
    max_prep_time: existing.preferences?.max_prep_time || 30,
  };

  const prompt = buildDailyPrompt(profile);
  const raw = await generateContent(prompt);
  const parsed = parseJSON(raw);

  const meals = transformDailyResponse(parsed);

  existing.meals = meals;
  existing.updatedAt = new Date();
  await existing.save();

  return existing;
};

module.exports = {
  generateMealPlan,
  getUserMealPlans,
  getMealPlanById,
  deleteMealPlan,
  regenerateMealPlan,
};
