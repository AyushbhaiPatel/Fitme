const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const mealPlanService = require('../services/mealPlanService');
const { analyzeNutrition } = require('../services/nutritionService');

const router = express.Router();

// Rate limiters
const generateLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, message: 'Too many generation requests. Try again in a minute.' } });
const regenerateLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, message: { success: false, message: 'Too many regeneration requests. Try again in a minute.' } });
const nutritionLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, message: 'Too many nutrition requests. Try again in a minute.' } });

// ── Static routes first (before :planId) ──

/** POST /api/mealplan/generate */
router.post('/generate', authenticate, generateLimiter, async (req, res) => {
  try {
    const body = req.body;
    const base = body.user_profile || body;
    const profile = {
      ...base,
      cooking_skill: body.cooking_skill || base.cooking_skill,
      meal_focus: body.meal_focus || base.meal_focus,
      max_prep_time: body.max_prep_time || base.max_prep_time,
      budget_range: body.budget_range || base.budget_range,
    };
    const userId = req.user._id || req.user.id;
    const plan = await mealPlanService.generateMealPlan(profile, userId);
    res.json({ success: true, message: 'Meal plan generated successfully', data: plan });
  } catch (error) {
    console.error('Meal plan generation error:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate meal plan' });
  }
});

/** POST /api/mealplan/regenerate/:planId */
router.post('/regenerate/:planId', authenticate, regenerateLimiter, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const plan = await mealPlanService.regenerateMealPlan(req.params.planId, userId);
    res.json({ success: true, message: 'Meal plan regenerated', data: plan });
  } catch (error) {
    console.error('Regenerate meal plan error:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to regenerate meal plan' });
  }
});

/** POST /api/mealplan/nutrition/analyze */
router.post('/nutrition/analyze', authenticate, nutritionLimiter, async (req, res) => {
  try {
    const { food_items, portions } = req.body;
    if (!food_items || !Array.isArray(food_items) || food_items.length === 0) {
      return res.status(400).json({ success: false, message: 'food_items array is required' });
    }
    const result = await analyzeNutrition(food_items, portions);
    res.json(result);
  } catch (error) {
    console.error('Nutrition analysis error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to analyze nutrition' });
  }
});

// ── Parameterized routes ──

/** GET /api/mealplan */
router.get('/', authenticate, async (req, res) => {
  try {
    const { limit = 10, skip = 0 } = req.query;
    const userId = req.user._id || req.user.id;
    const plans = await mealPlanService.getUserMealPlans(userId, parseInt(limit), parseInt(skip));
    res.json({ success: true, data: plans });
  } catch (error) {
    console.error('Get meal plans error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch meal plans' });
  }
});

/** GET /api/mealplan/:planId */
router.get('/:planId', authenticate, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const plan = await mealPlanService.getMealPlanById(req.params.planId, userId);
    if (!plan) return res.status(404).json({ success: false, message: 'Meal plan not found' });
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Get meal plan error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch meal plan' });
  }
});

/** DELETE /api/mealplan/:planId */
router.delete('/:planId', authenticate, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const plan = await mealPlanService.deleteMealPlan(req.params.planId, userId);
    if (!plan) return res.status(404).json({ success: false, message: 'Meal plan not found' });
    res.json({ success: true, message: 'Meal plan deleted' });
  } catch (error) {
    console.error('Delete meal plan error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete meal plan' });
  }
});

module.exports = router;
