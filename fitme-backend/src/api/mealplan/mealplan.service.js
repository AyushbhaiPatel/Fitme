const { Format } = require('../../config/format');
const mealplanDao = require('./mealplan.dao');
const { generateContent, isAvailable } = require('../../config/gemini');

const parseJSON = (text) => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
};

const buildDailyPrompt = (profile) => {
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
  const cuisinePref = profile.preferred_cuisines?.length ? `Focus on ${profile.preferred_cuisines.join(', ')} cuisine. ` : '';
  const mealFocus = profile.meal_focus || 'balanced';
  const maxPrep = profile.max_prep_time || 30;

  return `Create a daily meal plan with detailed nutrition information for a person with these characteristics:
- Age: ${age}, Weight: ${weight}kg, Height: ${height}cm
- Gender: ${gender}, Activity: ${activity}
- Fitness Goal: ${goal}
- Dietary Preferences: ${dietary}
- Allergies: ${allergies}
- Dislikes: ${dislikes}
- Cooking Skill: ${skill}
- ${cuisinePref}Meal focus: ${mealFocus}
- Maximum prep time per meal: ${maxPrep} minutes

Return ONLY a JSON object with this exact structure:
{
  "day": "Today",
  "breakfast": { "name": "Meal Name", "description": "Brief description", "ingredients": [{"name": "ingredient1", "amount": "quantity with unit"}], "instructions": ["step1"], "prep_time": 15, "cuisine_type": "international", "difficulty": "beginner", "portion_size": "1 serving", "total_nutrition": {"calories": 400, "protein": 25, "carbs": 45, "fat": 12, "fiber": 5, "sugar": 8} },
  "lunch": { same structure },
  "dinner": { same structure },
  "daily_totals": {"calories": 1800, "protein": 120, "carbs": 200, "fat": 60, "fiber": 25, "sugar": 40}
}

Ensure all nutrition values are realistic numbers, not strings.`;
};

const transformDailyResponse = (data) => {
  const transformMeal = (mealData) => {
    if (!mealData) return null;
    return {
      name: mealData.name,
      description: mealData.description || '',
      ingredients: (mealData.ingredients || []).map((i) => (typeof i === 'string' ? i : i.name || String(i))),
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

module.exports.generateMealPlan = async (profile, userId) => {
  if (!isAvailable()) {
    return Format.internalError('AI meal generation service is not available. Please check server configuration.');
  }

  const raw = await generateContent(buildDailyPrompt(profile));
  const parsed = parseJSON(raw);

  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    if (!parsed[meal]) throw new Error(`Missing ${meal} in generated plan`);
  }

  const meals = transformDailyResponse(parsed);
  const plan = await mealplanDao.createPlan({
    userId,
    meals,
    preferences: { meal_focus: profile.meal_focus, cooking_skill: profile.cooking_skill, max_prep_time: profile.max_prep_time },
  });

  return Format.created(plan, 'Meal plan generated successfully');
};

module.exports.getUserMealPlans = async (userId, limit, skip) => {
  const plans = await mealplanDao.getUserPlans(userId, limit, skip);
  return Format.success(plans);
};

module.exports.getMealPlanById = async (planId, userId) => {
  const plan = await mealplanDao.findByIdAndUser(planId, userId);
  if (!plan) return Format.notFound('Meal plan not found');
  return Format.success(plan);
};

module.exports.deleteMealPlan = async (planId, userId) => {
  const plan = await mealplanDao.deleteByIdAndUser(planId, userId);
  if (!plan) return Format.notFound('Meal plan not found');
  return Format.success(null, 'Meal plan deleted');
};

module.exports.regenerateMealPlan = async (planId, userId) => {
  const existing = await mealplanDao.findByIdAndUser(planId, userId);
  if (!existing) return Format.notFound('Meal plan not found');

  const profile = {
    ...(existing.preferences || {}),
    meal_focus: existing.preferences?.meal_focus || 'balanced',
    cooking_skill: existing.preferences?.cooking_skill || 'intermediate',
    max_prep_time: existing.preferences?.max_prep_time || 30,
  };

  const raw = await generateContent(buildDailyPrompt(profile));
  const parsed = parseJSON(raw);
  existing.meals = transformDailyResponse(parsed);
  await mealplanDao.savePlan(existing);

  return Format.success(existing, 'Meal plan regenerated');
};

// Nutrition analysis
const getEstimatedNutrition = (foodName) => {
  const f = foodName.toLowerCase();
  if (['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'egg', 'tofu'].some((w) => f.includes(w))) return { calories: 150, protein: 20, carbs: 0, fat: 8 };
  if (['rice', 'pasta', 'bread', 'oats', 'quinoa', 'potato'].some((w) => f.includes(w))) return { calories: 120, protein: 4, carbs: 25, fat: 1 };
  if (['broccoli', 'spinach', 'carrot', 'tomato', 'pepper', 'onion', 'lettuce'].some((w) => f.includes(w))) return { calories: 25, protein: 2, carbs: 5, fat: 0 };
  if (['apple', 'banana', 'orange', 'berry', 'grape', 'pear'].some((w) => f.includes(w))) return { calories: 50, protein: 1, carbs: 12, fat: 0 };
  if (['milk', 'cheese', 'yogurt', 'butter'].some((w) => f.includes(w))) return { calories: 100, protein: 8, carbs: 5, fat: 6 };
  if (['oil', 'avocado', 'nuts', 'seeds'].some((w) => f.includes(w))) return { calories: 500, protein: 5, carbs: 5, fat: 50 };
  return { calories: 100, protein: 3, carbs: 15, fat: 3 };
};

module.exports.analyzeNutrition = async (foodItems, portions = []) => {
  if (!foodItems || !Array.isArray(foodItems) || foodItems.length === 0) {
    return Format.badRequest('food_items array is required');
  }

  if (!isAvailable()) {
    const results = {};
    foodItems.forEach((item) => { results[item] = getEstimatedNutrition(item); });
    return Format.success({ nutrition_data: results }, 'Estimated nutrition (AI unavailable)');
  }

  try {
    const itemsList = foodItems.map((item, i) => `- ${item}${portions[i] ? ` (${portions[i]})` : ''}`).join('\n');
    const prompt = `Analyze the nutritional content of these food items per serving:\n${itemsList}\n\nReturn ONLY a valid JSON object where each key is the food item name and the value has:\n{ "calories": number, "protein": number, "carbs": number, "fat": number }`;

    let text = (await generateContent(prompt, { maxOutputTokens: 2048 })).trim();
    if (text.startsWith('```json')) text = text.slice(7);
    if (text.startsWith('```')) text = text.slice(3);
    if (text.endsWith('```')) text = text.slice(0, -3);

    const data = JSON.parse(text.trim());
    return Format.success({ nutrition_data: data }, 'Nutrition analysis complete');
  } catch (err) {
    console.error('Nutrition analysis error:', err.message);
    const results = {};
    foodItems.forEach((item) => { results[item] = getEstimatedNutrition(item); });
    return Format.success({ nutrition_data: results }, 'Estimated nutrition (analysis failed)');
  }
};
