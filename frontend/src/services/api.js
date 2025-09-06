import axios from 'axios';

// Single Express backend — no FastAPI, no client-side Gemini key
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Create axios instance
const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Token management
const getToken = () => localStorage.getItem('fitme_token');
const setToken = (token) => {
  if (token) {
    localStorage.setItem('fitme_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
};
const removeToken = () => {
  localStorage.removeItem('fitme_token');
  delete api.defaults.headers.common['Authorization'];
};

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Restore token on load
const existingToken = getToken();
if (existingToken) {
  api.defaults.headers.common['Authorization'] = `Bearer ${existingToken}`;
}

// Response interceptor — refresh token on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('fitme_refresh_token');
        if (refreshToken) {
          const response = await api.post('/auth/refresh', { refreshToken });
          const { accessToken, refreshToken: newRefreshToken } = response.data.data.tokens;
          setToken(accessToken);
          localStorage.setItem('fitme_refresh_token', newRefreshToken);
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        removeToken();
        localStorage.removeItem('fitme_refresh_token');
        localStorage.removeItem('fitme_user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

// ─── Authentication API ───
export const authAPI = {
  register: async (userData) => {
    const response = await api.post('/auth/register', userData);
    return response.data;
  },
  login: async (credentials) => {
    const response = await api.post('/auth/login', credentials);
    return response.data;
  },
  logout: async () => {
    const response = await api.post('/auth/logout');
    return response.data;
  },
  refreshToken: async (refreshToken) => {
    const response = await api.post('/auth/refresh', { refreshToken });
    return response.data;
  },
  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },
  changePassword: async (passwordData) => {
    const response = await api.put('/auth/change-password', passwordData);
    return response.data;
  },
  verifyToken: async () => {
    const response = await api.get('/auth/verify');
    return response.data;
  },
  sendOTP: async (email) => {
    const response = await api.post('/auth/send-otp', { email });
    return response.data;
  },
  verifyOTP: async (email, otp) => {
    const response = await api.post('/auth/verify-otp', { email, otp });
    return response.data;
  },
  resendOTP: async (email) => {
    const response = await api.post('/auth/resend-otp', { email });
    return response.data;
  },
  requestPasswordReset: async (email) => {
    const response = await api.post('/auth/forgot-password/request', { email });
    return response.data;
  },
  resetPasswordWithOTP: async ({ email, otp, newPassword, confirmPassword }) => {
    const response = await api.post('/auth/forgot-password/confirm', { email, otp, password: newPassword, confirmPassword });
    return response.data;
  },
};

// ─── User API ───
export const userAPI = {
  updateProfile: async (profileData) => {
    const response = await api.put('/user/profile', profileData);
    return response.data;
  },
  updateProfilePhoto: async (profilePhoto) => {
    const response = await api.put('/user/profile-photo', { profilePhoto });
    return response.data;
  },
  deleteProfilePhoto: async () => {
    const response = await api.delete('/user/profile-photo');
    return response.data;
  },
  getUserStats: async () => {
    const response = await api.get('/user/stats');
    return response.data;
  },
  updateEmail: async (emailData) => {
    const response = await api.put('/user/email', emailData);
    return response.data;
  },
  getPreferences: async () => {
    const response = await api.get('/user/preferences');
    return response.data;
  },
  deleteAccount: async (password) => {
    const response = await api.delete('/user/account', { data: { password } });
    return response.data;
  },
};

// ─── Workout API ───  (generation now server-side)
export const workoutAPI = {
  generateWorkoutPlan: async (enhancedProfile = null) => {
    try {
      const response = await api.post('/workouts/generate', enhancedProfile || {});
      return response.data;
    } catch (error) {
      console.error('Workout generation failed:', error);
      return {
        success: true,
        workoutPlan: {
          goal: 'General Fitness',
          duration_per_day_minutes: 30,
          preference: ['Cardio', 'Strength'],
          days: [{
            day: 'Day 1', workout_type: 'Full Body', estimated_calories_burned: 250,
            exercises: [
              { name: 'Push-ups', type: 'Strength', sets: 3, reps: 10, rest_between_sets_seconds: 60, description: 'Standard push-ups.', calories_burned: 50 },
              { name: 'Squats', type: 'Strength', sets: 3, reps: 15, rest_between_sets_seconds: 60, description: 'Bodyweight squats.', calories_burned: 60 },
            ],
          }],
        },
        message: 'Fallback workout plan',
        isDemoMode: true,
      };
    }
  },
  saveWorkoutPlan: async (workoutPlan, name) => {
    const response = await api.post('/workouts/save', { workoutPlan, name });
    return response.data;
  },
  getSavedWorkoutPlans: async (options = {}) => {
    const { page = 1, limit = 10, sort = 'createdAt' } = options;
    const response = await api.get('/workouts/saved', { params: { page, limit, sort } });
    return response.data;
  },
  getWorkoutPlanById: async (planId) => {
    const response = await api.get(`/workouts/${planId}`);
    return response.data;
  },
  deleteWorkoutPlan: async (planId) => {
    const response = await api.delete(`/workouts/${planId}`);
    return response.data;
  },
  setActivePlan: async (planId) => {
    const response = await api.put(`/workouts/${planId}/activate`);
    return response.data;
  },
  createCustomWorkout: async (name, exercises) => {
    const response = await api.post('/workouts/custom', { name, exercises });
    return response.data;
  },
  completeWorkout: async (workoutData) => {
    const response = await api.post('/workouts/complete', workoutData);
    return response.data;
  },
  getWorkoutStatistics: async () => {
    const response = await api.get('/workouts/statistics');
    return response.data;
  },
  getWeeklySummary: async () => {
    const response = await api.get('/workouts/weekly-summary');
    return response.data;
  },
};

// ─── AI Coach API ───  (now uses Express, not FastAPI)
export const aiCoachAPI = {
  chat: async (message, conversationHistory = []) => {
    const response = await api.post('/aicoach/chat', { message, conversationHistory });
    return response.data;
  },
  getSuggestions: async () => {
    const response = await api.get('/aicoach/suggestions');
    return response.data;
  },
  healthCheck: async () => {
    const response = await api.get('/aicoach/health');
    return response.data;
  },
};

// ─── Health check ───
export const healthAPI = {
  check: async () => {
    const response = await api.get('/health');
    return response.data;
  },
};

// ─── Utilities ───
export const apiUtils = {
  setAuthToken: setToken,
  getAuthToken: getToken,
  removeAuthToken: removeToken,
  handleError: (error) => {
    if (error.response) {
      const { status, data } = error.response;
      if (data.errorCode) {
        return {
          message: data.message,
          errorCode: data.errorCode,
          suggestions: data.suggestions || [],
          field: data.field,
          errors: data.errors || [],
          missingFields: data.missingFields,
          attemptsRemaining: data.attemptsRemaining,
          timeRemaining: data.timeRemaining,
        };
      }
      const messages = {
        400: { message: data.message || 'Invalid request.', errorCode: 'BAD_REQUEST' },
        401: { message: data.message || 'Authentication failed.', errorCode: 'UNAUTHORIZED' },
        403: { message: 'Access denied.', errorCode: 'FORBIDDEN' },
        404: { message: 'Resource not found.', errorCode: 'NOT_FOUND' },
        429: { message: data.message || 'Too many requests.', errorCode: 'RATE_LIMITED' },
        500: { message: 'Server error.', errorCode: 'SERVER_ERROR' },
      };
      return messages[status] || { message: data.message || 'Unexpected error', code: 'UNKNOWN_ERROR' };
    }
    if (error.request) return { message: 'Network error.', code: 'NETWORK_ERROR' };
    return { message: error.message || 'Unexpected error', code: 'UNKNOWN_ERROR' };
  },
};

export default api;
