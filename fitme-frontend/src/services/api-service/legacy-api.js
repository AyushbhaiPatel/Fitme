// Backward-compat shim - new code should use module-level services
// All API calls go through the shared axios client

import axiosClient, { setToken, getToken, removeToken, handleApiError } from './axios-client';

// Authentication API
export const authAPI = {
  register: (userData) => axiosClient.post('/auth/register', userData).then((r) => r.data),
  login: (credentials) => axiosClient.post('/auth/login', credentials).then((r) => r.data),
  logout: () => axiosClient.post('/auth/logout').then((r) => r.data),
  refreshToken: (refreshToken) => axiosClient.post('/auth/refresh', { refreshToken }).then((r) => r.data),
  getMe: () => axiosClient.get('/auth/me').then((r) => r.data),
  changePassword: (passwordData) => axiosClient.put('/auth/change-password', passwordData).then((r) => r.data),
  verifyToken: () => axiosClient.get('/auth/verify').then((r) => r.data),
  sendOTP: (email) => axiosClient.post('/auth/send-otp', { email }).then((r) => r.data),
  verifyOTP: (email, otp) => axiosClient.post('/auth/verify-otp', { email, otp }).then((r) => r.data),
  resendOTP: (email) => axiosClient.post('/auth/resend-otp', { email }).then((r) => r.data),
  requestPasswordReset: (email) => axiosClient.post('/auth/forgot-password/request', { email }).then((r) => r.data),
  resetPasswordWithOTP: ({ email, otp, newPassword, confirmPassword }) =>
    axiosClient.post('/auth/forgot-password/confirm', { email, otp, password: newPassword, confirmPassword }).then((r) => r.data),
};

// User API
export const userAPI = {
  updateProfile: (profileData) => axiosClient.put('/user/profile', profileData).then((r) => r.data),
  updateProfilePhoto: (profilePhoto) => axiosClient.put('/user/profile-photo', { profilePhoto }).then((r) => r.data),
  deleteProfilePhoto: () => axiosClient.delete('/user/profile-photo').then((r) => r.data),
  getUserStats: () => axiosClient.get('/user/stats').then((r) => r.data),
  updateEmail: (emailData) => axiosClient.put('/user/email', emailData).then((r) => r.data),
  getPreferences: () => axiosClient.get('/user/preferences').then((r) => r.data),
  deleteAccount: (password) => axiosClient.delete('/user/account', { data: { password } }).then((r) => r.data),
};

// Workout API
export const workoutAPI = {
  generateWorkoutPlan: async (enhancedProfile = null) => {
    try {
      return await axiosClient.post('/workouts/generate', enhancedProfile || {}).then((r) => r.data);
    } catch {
      return {
        success: true,
        workoutPlan: {
          goal: 'General Fitness', duration_per_day_minutes: 30, preference: ['Cardio', 'Strength'],
          days: [{ day: 'Day 1', workout_type: 'Full Body', estimated_calories_burned: 250, exercises: [
            { name: 'Push-ups', type: 'Strength', sets: 3, reps: 10, rest_between_sets_seconds: 60, description: 'Standard push-ups.', calories_burned: 50 },
            { name: 'Squats', type: 'Strength', sets: 3, reps: 15, rest_between_sets_seconds: 60, description: 'Bodyweight squats.', calories_burned: 60 },
          ]}],
        },
        message: 'Fallback workout plan', isDemoMode: true,
      };
    }
  },
  saveWorkoutPlan: (workoutPlan, name) => axiosClient.post('/workouts/save', { workoutPlan, name }).then((r) => r.data),
  getSavedWorkoutPlans: (options = {}) => {
    const { page = 1, limit = 10, sort = 'createdAt' } = options;
    return axiosClient.get('/workouts/saved', { params: { page, limit, sort } }).then((r) => r.data);
  },
  getWorkoutPlanById: (planId) => axiosClient.get(`/workouts/${planId}`).then((r) => r.data),
  deleteWorkoutPlan: (planId) => axiosClient.delete(`/workouts/${planId}`).then((r) => r.data),
  setActivePlan: (planId) => axiosClient.put(`/workouts/${planId}/activate`).then((r) => r.data),
  createCustomWorkout: (name, exercises) => axiosClient.post('/workouts/custom', { name, exercises }).then((r) => r.data),
  completeWorkout: (workoutData) => axiosClient.post('/workouts/complete', workoutData).then((r) => r.data),
  getWorkoutStatistics: () => axiosClient.get('/workouts/statistics').then((r) => r.data),
  getWeeklySummary: () => axiosClient.get('/workouts/weekly-summary').then((r) => r.data),
};

// AI Coach API
export const aiCoachAPI = {
  chat: (message, conversationHistory = []) => axiosClient.post('/aicoach/chat', { message, conversationHistory }).then((r) => r.data),
  getSuggestions: () => axiosClient.get('/aicoach/suggestions').then((r) => r.data),
  healthCheck: () => axiosClient.get('/aicoach/health').then((r) => r.data),
};

// Health check
export const healthAPI = {
  check: () => axiosClient.get('/health').then((r) => r.data),
};

// Utilities
export const apiUtils = {
  setAuthToken: setToken,
  getAuthToken: getToken,
  removeAuthToken: removeToken,
  handleError: handleApiError,
};

export default axiosClient;
