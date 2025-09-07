const MealPlan = require('./mealplan.model');

module.exports.createPlan = (payload) => MealPlan.create(payload);

module.exports.getUserPlans = (userId, limit = 10, skip = 0) =>
  MealPlan.find({ userId }).sort({ created_at: -1 }).skip(skip).limit(limit);

module.exports.findByIdAndUser = (planId, userId) => MealPlan.findOne({ _id: planId, userId });

module.exports.deleteByIdAndUser = (planId, userId) => MealPlan.findOneAndDelete({ _id: planId, userId });

module.exports.savePlan = (plan) => plan.save();
