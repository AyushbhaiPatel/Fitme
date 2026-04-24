const authDocs = require('../api/auth/auth.doc');
const userDocs = require('../api/user/user.doc');
const workoutDocs = require('../api/workout/workout.doc');
const mealplanDocs = require('../api/mealplan/mealplan.doc');
const aicoachDocs = require('../api/aicoach/aicoach.doc');

const docs = [authDocs, userDocs, workoutDocs, mealplanDocs, aicoachDocs];

module.exports = {
  docs,
  registerDocsRoute(app) {
    app.get('/api/docs', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'API documentation index',
        data: docs,
      });
    });
  },
};
