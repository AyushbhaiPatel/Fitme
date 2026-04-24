const router = require('express').Router();

const authRoutes = require('./auth/auth.routes');
const userRoutes = require('./user/user.routes');
const workoutRoutes = require('./workout/workout.routes');
const mealplanRoutes = require('./mealplan/mealplan.routes');
const aicoachRoutes = require('./aicoach/aicoach.routes');

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/workouts', workoutRoutes);
router.use('/mealplan', mealplanRoutes);
router.use('/aicoach', aicoachRoutes);

module.exports = router;
