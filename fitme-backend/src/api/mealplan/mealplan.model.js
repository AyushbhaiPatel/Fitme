const mongoose = require('mongoose');

const nutritionSchema = new mongoose.Schema(
  { calories: { type: Number, default: 0 }, protein: { type: Number, default: 0 }, carbs: { type: Number, default: 0 }, fat: { type: Number, default: 0 }, fiber: { type: Number, default: 0 }, sugar: { type: Number, default: 0 } },
  { _id: false }
);

const mealSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    ingredients: [{ type: String }],
    instructions: [{ type: String }],
    prep_time: { type: Number, default: 0 },
    nutrition: { type: nutritionSchema, default: null },
    cuisine_type: { type: String, default: '' },
    difficulty: { type: String, default: 'intermediate' },
    portion_size: { type: String, default: '1 serving' },
  },
  { _id: false }
);

const mealsSchema = new mongoose.Schema(
  {
    breakfast: { type: mealSchema, default: null },
    lunch: { type: mealSchema, default: null },
    dinner: { type: mealSchema, default: null },
    snack: { type: mealSchema, default: null },
    total_calories: { type: Number, default: 0 },
    total_protein: { type: Number, default: 0 },
    total_carbs: { type: Number, default: 0 },
    total_fat: { type: Number, default: 0 },
  },
  { _id: false }
);

const mealPlanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    meals: { type: mealsSchema, required: true },
    preferences: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = mongoose.model('MealPlan', mealPlanSchema);
