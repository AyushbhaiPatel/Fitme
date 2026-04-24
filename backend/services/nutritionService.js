const { generateContent, isAvailable } = require('./geminiClient');

/**
 * Get estimated nutrition when Gemini is unavailable
 */
const getEstimatedNutrition = (foodName) => {
  const f = foodName.toLowerCase();

  if (['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'egg', 'tofu'].some((w) => f.includes(w)))
    return { calories: 150, protein: 20, carbs: 0, fat: 8 };
  if (['rice', 'pasta', 'bread', 'oats', 'quinoa', 'potato'].some((w) => f.includes(w)))
    return { calories: 120, protein: 4, carbs: 25, fat: 1 };
  if (['broccoli', 'spinach', 'carrot', 'tomato', 'pepper', 'onion', 'lettuce'].some((w) => f.includes(w)))
    return { calories: 25, protein: 2, carbs: 5, fat: 0 };
  if (['apple', 'banana', 'orange', 'berry', 'grape', 'pear'].some((w) => f.includes(w)))
    return { calories: 50, protein: 1, carbs: 12, fat: 0 };
  if (['milk', 'cheese', 'yogurt', 'butter'].some((w) => f.includes(w)))
    return { calories: 100, protein: 8, carbs: 5, fat: 6 };
  if (['oil', 'avocado', 'nuts', 'seeds'].some((w) => f.includes(w)))
    return { calories: 500, protein: 5, carbs: 5, fat: 50 };

  return { calories: 100, protein: 3, carbs: 15, fat: 3 };
};

/**
 * Analyze nutrition for a list of food items using Gemini, with local fallback
 */
const analyzeNutrition = async (foodItems, portions = []) => {
  if (!isAvailable()) {
    // Fallback to local estimates
    const results = {};
    foodItems.forEach((item, i) => {
      results[item] = getEstimatedNutrition(item);
    });
    return { success: true, message: 'Estimated nutrition (AI unavailable)', nutrition_data: results };
  }

  try {
    const itemsList = foodItems
      .map((item, i) => `- ${item}${portions[i] ? ` (${portions[i]})` : ''}`)
      .join('\n');

    const prompt = `Analyze the nutritional content of these food items per serving:
${itemsList}

Return ONLY a valid JSON object where each key is the food item name and the value has:
{ "calories": number, "protein": number, "carbs": number, "fat": number }

Provide realistic values based on standard nutritional databases.`;

    const text = await generateContent(prompt, { maxOutputTokens: 2048 });
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

    const data = JSON.parse(cleaned.trim());
    return { success: true, message: 'Nutrition analysis complete', nutrition_data: data };
  } catch (err) {
    console.error('Nutrition analysis error:', err.message);
    // Fallback
    const results = {};
    foodItems.forEach((item) => {
      results[item] = getEstimatedNutrition(item);
    });
    return { success: true, message: 'Estimated nutrition (analysis failed)', nutrition_data: results };
  }
};

module.exports = { analyzeNutrition, getEstimatedNutrition };
