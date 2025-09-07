const mealplanService = require('./mealplan.service');

module.exports.generateMealPlan = async (req, res, next) => {
  try {
    const body = req.body;
    const base = body.user_profile || body;
    const profile = { ...base, cooking_skill: body.cooking_skill || base.cooking_skill, meal_focus: body.meal_focus || base.meal_focus, max_prep_time: body.max_prep_time || base.max_prep_time, budget_range: body.budget_range || base.budget_range };
    const result = await mealplanService.generateMealPlan(profile, req.user._id || req.user.id);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getUserMealPlans = async (req, res, next) => {
  try {
    const { limit = 10, skip = 0 } = req.query;
    const result = await mealplanService.getUserMealPlans(req.user._id || req.user.id, parseInt(limit), parseInt(skip));
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getMealPlanById = async (req, res, next) => {
  try {
    const result = await mealplanService.getMealPlanById(req.params.planId, req.user._id || req.user.id);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.deleteMealPlan = async (req, res, next) => {
  try {
    const result = await mealplanService.deleteMealPlan(req.params.planId, req.user._id || req.user.id);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.regenerateMealPlan = async (req, res, next) => {
  try {
    const result = await mealplanService.regenerateMealPlan(req.params.planId, req.user._id || req.user.id);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.analyzeNutrition = async (req, res, next) => {
  try {
    const { food_items, portions } = req.body;
    const result = await mealplanService.analyzeNutrition(food_items, portions);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};
