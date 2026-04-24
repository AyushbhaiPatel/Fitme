export const nutritionApiRoutes = {
  generate: '/mealplan/generate',
  list: '/mealplan/',
  byId: (id) => `/mealplan/${id}`,
  regenerate: (id) => `/mealplan/regenerate/${id}`,
  analyzeNutrition: '/mealplan/nutrition/analyze',
};
