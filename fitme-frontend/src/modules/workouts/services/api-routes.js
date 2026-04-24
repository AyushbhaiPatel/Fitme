export const workoutApiRoutes = {
  generate: '/workouts/generate',
  save: '/workouts/save',
  saved: '/workouts/saved',
  byId: (id) => `/workouts/${id}`,
  activate: (id) => `/workouts/${id}/activate`,
  custom: '/workouts/custom',
  complete: '/workouts/complete',
  statistics: '/workouts/statistics',
  weeklySummary: '/workouts/weekly-summary',
};
