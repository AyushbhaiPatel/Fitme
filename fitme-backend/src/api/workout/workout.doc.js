module.exports = {
  feature: 'workout',
  basePath: '/api/workouts',
  endpoints: [
    { method: 'POST', path: '/generate', description: 'Generate a workout plan' },
    { method: 'POST', path: '/save', description: 'Save a generated workout plan' },
    { method: 'POST', path: '/custom', description: 'Create a custom workout' },
    { method: 'POST', path: '/complete', description: 'Record a completed workout. Idempotent per user with body `clientSessionId` (or `Idempotency-Key` header, 8-64 chars [A-Za-z0-9_-]): a repeat returns 200 with `data.duplicate: true`, a different payload under the same key returns 409' },
    { method: 'GET', path: '/saved', description: 'List saved workout plans' },
    { method: 'GET', path: '/statistics', description: 'Get workout statistics (?include=history&from=&to=&historyLimit= adds bounded history)' },
    { method: 'GET', path: '/weekly-summary', description: 'Get weekly workout summary' },
    { method: 'GET', path: '/history', description: 'Paginated complete workout history (?page=&limit=&order=asc|desc&from=&to=)' },
    { method: 'GET', path: '/:planId', description: 'Get one workout plan by id' },
    { method: 'DELETE', path: '/:planId', description: 'Delete a workout plan by id' },
    { method: 'PUT', path: '/:planId/activate', description: 'Set one workout plan as active' },
  ],
};
