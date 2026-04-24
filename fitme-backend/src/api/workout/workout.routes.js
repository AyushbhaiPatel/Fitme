const router = require('express').Router();
const workoutController = require('./workout.controller');
const { authenticate } = require('../../middleware/auth');

router.post('/generate', authenticate, workoutController.generateWorkoutPlan);
router.post('/save', authenticate, workoutController.saveWorkoutPlan);
router.post('/custom', authenticate, workoutController.createCustomWorkout);
router.post('/complete', authenticate, workoutController.completeWorkout);
router.get('/saved', authenticate, workoutController.getSavedWorkoutPlans);
router.get('/statistics', authenticate, workoutController.getWorkoutStatistics);
router.get('/weekly-summary', authenticate, workoutController.getWeeklySummary);
router.get('/:planId', authenticate, workoutController.getWorkoutPlanById);
router.delete('/:planId', authenticate, workoutController.deleteWorkoutPlan);
router.put('/:planId/activate', authenticate, workoutController.setActivePlan);

module.exports = router;
