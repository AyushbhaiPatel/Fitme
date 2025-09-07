const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const mealplanController = require('./mealplan.controller');
const { authenticate } = require('../../middleware/auth');

const generateLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, message: 'Too many generation requests. Try again in a minute.' } });
const regenerateLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, message: { success: false, message: 'Too many regeneration requests. Try again in a minute.' } });
const nutritionLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, message: 'Too many nutrition requests. Try again in a minute.' } });

router.post('/generate', authenticate, generateLimiter, mealplanController.generateMealPlan);
router.post('/regenerate/:planId', authenticate, regenerateLimiter, mealplanController.regenerateMealPlan);
router.post('/nutrition/analyze', authenticate, nutritionLimiter, mealplanController.analyzeNutrition);
router.get('/', authenticate, mealplanController.getUserMealPlans);
router.get('/:planId', authenticate, mealplanController.getMealPlanById);
router.delete('/:planId', authenticate, mealplanController.deleteMealPlan);

module.exports = router;
