const WorkoutPlan = require('./workout.model');
const User = require('../user/user.model');

module.exports.createPlan = (payload) => {
  const plan = new WorkoutPlan(payload);
  return plan.save();
};

module.exports.getUserPlans = (userId, options) => WorkoutPlan.getUserPlans(userId, options);

module.exports.countUserPlans = (userId) => WorkoutPlan.countDocuments({ userId });

module.exports.findPlanByIdAndUser = (planId, userId) => WorkoutPlan.findOne({ _id: planId, userId });

module.exports.deletePlanByIdAndUser = (planId, userId) => WorkoutPlan.findOneAndDelete({ _id: planId, userId });

module.exports.findUserById = (userId) => User.findById(userId);

module.exports.saveUser = (user) => user.save();
