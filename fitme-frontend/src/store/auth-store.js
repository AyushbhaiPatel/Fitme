// Zustand auth store — single source of truth for authentication state

import { create } from 'zustand';
import axiosClient, {
  setToken,
  removeToken,
  getToken,
  handleApiError,
} from '../services/api-service/axios-client';

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem('fitme_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const persistUser = (user) => {
  if (user) localStorage.setItem('fitme_user', JSON.stringify(user));
};

export const useAuthStore = create((set, get) => ({
  user: null,
  userStats: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  successMessage: null,
  isInitialized: false,

  clearError: () => set({ error: null }),
  clearSuccessMessage: () => set({ successMessage: null }),

  initializeAuth: () => {
    const token = getToken();
    const user = getStoredUser();
    if (token && user) {
      setToken(token);
      set({ user, isAuthenticated: true, isInitialized: true, loading: false });
    } else {
      removeToken();
      set({ user: null, isAuthenticated: false, isInitialized: true, loading: false });
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await axiosClient.post('/auth/login', { email, password });
      const { user, tokens } = res.data.data;
      if (!tokens?.accessToken) throw new Error('No access token received');
      setToken(tokens.accessToken);
      localStorage.setItem('fitme_refresh_token', tokens.refreshToken);
      persistUser(user);
      set({ user, isAuthenticated: true, loading: false, error: null, successMessage: 'Login successful!' });
      return { success: true, tokens };
    } catch (err) {
      const error = handleApiError(err);
      set({ loading: false, error: error.message, isAuthenticated: false, user: null });
      removeToken();
      return { success: false, ...error };
    }
  },

  register: async (userData) => {
    set({ loading: true, error: null });
    try {
      const res = await axiosClient.post('/auth/register', userData);
      const { user, tokens, requiresEmailVerification } = res.data.data;
      persistUser(user);
      if (tokens?.accessToken) {
        setToken(tokens.accessToken);
        if (tokens.refreshToken) localStorage.setItem('fitme_refresh_token', tokens.refreshToken);
        set({ user, isAuthenticated: true, loading: false, error: null, successMessage: 'Registration successful!' });
        return { success: true, user, tokens, requiresEmailVerification: false };
      }
      set({ user, isAuthenticated: false, loading: false, error: null, successMessage: 'Registration successful! Please verify your email.' });
      return { success: true, user, requiresEmailVerification: !!requiresEmailVerification };
    } catch (err) {
      const error = handleApiError(err);
      set({ loading: false, error: error.message, isAuthenticated: false, user: null });
      removeToken();
      return { success: false, message: error.message };
    }
  },

  logout: async () => {
    try { await axiosClient.post('/auth/logout'); } catch { /* ignore */ }
    removeToken();
    localStorage.removeItem('fitme_refresh_token');
    localStorage.removeItem('fitme_user');
    set({ user: null, userStats: null, isAuthenticated: false, loading: false, error: null, successMessage: 'Logged out successfully!' });
    return { success: true };
  },

  getCurrentUser: async () => {
    set({ loading: true });
    try {
      const res = await axiosClient.get('/auth/me');
      const user = res.data.data.user;
      persistUser(user);
      set({ user, isAuthenticated: true, loading: false, error: null });
      return user;
    } catch (err) {
      const error = handleApiError(err);
      set({ loading: false, error: error.message });
      throw error;
    }
  },

  updateUserProfile: async (profileData) => {
    set({ loading: true, error: null });
    try {
      const res = await axiosClient.put('/user/profile', profileData);
      const user = res.data.data.user;
      persistUser(user);
      set({ user, loading: false, error: null, successMessage: 'Profile updated successfully!' });
      return user;
    } catch (err) {
      const error = handleApiError(err);
      // Don't set global error for validation errors - let the UI handle inline
      if (Array.isArray(error.errors) && error.errors.length > 0) {
        set({ loading: false });
      } else {
        set({ loading: false, error: error.message || 'Profile update failed' });
      }
      throw error;
    }
  },

  updateProfilePhoto: async (profilePhoto) => {
    set({ loading: true, error: null });
    try {
      const res = await axiosClient.put('/user/profile-photo', { profilePhoto });
      const user = res.data.data.user;
      persistUser(user);
      set({ user, loading: false, error: null, successMessage: 'Profile photo updated successfully!' });
      return user;
    } catch (err) {
      const error = handleApiError(err);
      set({ loading: false, error: error.message });
      throw error.message;
    }
  },

  deleteProfilePhoto: async () => {
    set({ loading: true, error: null });
    try {
      const res = await axiosClient.delete('/user/profile-photo');
      const user = res.data.data.user;
      persistUser(user);
      set({ user, loading: false, error: null, successMessage: 'Profile photo deleted successfully!' });
      return user;
    } catch (err) {
      const error = handleApiError(err);
      set({ loading: false, error: error.message });
      throw error.message;
    }
  },

  changePassword: async (passwordData) => {
    set({ loading: true, error: null });
    try {
      const res = await axiosClient.put('/auth/change-password', passwordData);
      set({ loading: false, error: null, successMessage: res.data.message });
      return res.data.message;
    } catch (err) {
      const error = handleApiError(err);
      set({ loading: false, error: error.message });
      throw error.message;
    }
  },

  getUserStats: async () => {
    set({ loading: true });
    try {
      const res = await axiosClient.get('/user/stats');
      const stats = res.data.data.stats;
      set({ userStats: stats, loading: false, error: null });
      return stats;
    } catch (err) {
      const error = handleApiError(err);
      set({ loading: false, error: error.message });
      throw error.message;
    }
  },

  manualLogin: (userData, tokens) => {
    if (tokens) {
      setToken(tokens.accessToken);
      localStorage.setItem('fitme_refresh_token', tokens.refreshToken);
    }
    if (userData) persistUser(userData);
    get().initializeAuth();
    if (tokens) get().getCurrentUser();
  },

  updateUser: (partial) => {
    const updated = { ...get().user, ...partial };
    persistUser(updated);
    set({ user: updated });
  },
}));
