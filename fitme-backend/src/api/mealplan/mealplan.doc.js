module.exports = {
  feature: 'mealplan',
  basePath: '/api/mealplan',
  endpoints: [
    { method: 'POST', path: '/generate', description: 'Generate a meal plan for the authenticated user' },
    { method: 'POST', path: '/regenerate/:planId', description: 'Regenerate an existing meal plan' },
    { method: 'POST', path: '/nutrition/analyze', description: 'Analyze nutrition for food items' },
    { method: 'GET', path: '/', description: 'List the user meal plans' },
    { method: 'GET', path: '/:planId', description: 'Get one meal plan by id' },
    { method: 'DELETE', path: '/:planId', description: 'Delete a meal plan by id' },
  ],
};
