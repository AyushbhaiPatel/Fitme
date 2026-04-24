module.exports = {
  feature: 'workout',
  basePath: '/api/workouts',
  endpoints: [
    { method: 'POST', path: '/generate', description: 'Generate a workout plan' },
    { method: 'POST', path: '/save', description: 'Save a generated workout plan' },
    { method: 'POST', path: '/custom', description: 'Create a custom workout' },
    { method: 'POST', path: '/complete', description: 'Record a completed workout' },
    { method: 'GET', path: '/saved', description: 'List saved workout plans' },
    { method: 'GET', path: '/statistics', description: 'Get workout statistics' },
    { method: 'GET', path: '/weekly-summary', description: 'Get weekly workout summary' },
    { method: 'GET', path: '/:planId', description: 'Get one workout plan by id' },
    { method: 'DELETE', path: '/:planId', description: 'Delete a workout plan by id' },
    { method: 'PUT', path: '/:planId/activate', description: 'Set one workout plan as active' },
  ],
};
