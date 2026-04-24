const workoutService = require('./workout.service');

module.exports.generateWorkoutPlan = async (req, res, next) => {
  try {
    const result = await workoutService.generateWorkoutPlan(req.user._id || req.user.id, req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.saveWorkoutPlan = async (req, res, next) => {
  try {
    const result = await workoutService.saveWorkoutPlan(req.user._id || req.user.id, req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getSavedWorkoutPlans = async (req, res, next) => {
  try {
    const result = await workoutService.getSavedWorkoutPlans(req.user._id || req.user.id, req.query);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getWorkoutPlanById = async (req, res, next) => {
  try {
    const result = await workoutService.getWorkoutPlanById(req.user._id || req.user.id, req.params.planId);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.deleteWorkoutPlan = async (req, res, next) => {
  try {
    const result = await workoutService.deleteWorkoutPlan(req.user._id || req.user.id, req.params.planId);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.setActivePlan = async (req, res, next) => {
  try {
    const result = await workoutService.setActivePlan(req.user._id || req.user.id, req.params.planId);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.createCustomWorkout = async (req, res, next) => {
  try {
    const result = await workoutService.createCustomWorkout(req.user._id || req.user.id, req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.completeWorkout = async (req, res, next) => {
  try {
    const result = await workoutService.completeWorkout(req.user._id || req.user.id, req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getWorkoutStatistics = async (req, res, next) => {
  try {
    const result = await workoutService.getWorkoutStatistics(req.user._id || req.user.id);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getWeeklySummary = async (req, res, next) => {
  try {
    const result = await workoutService.getWeeklySummary(req.user._id || req.user.id);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};
