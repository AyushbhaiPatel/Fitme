// Auth context - thin wrapper around the Zustand auth store

import React, { createContext, useContext, useEffect } from 'react';
import { useAuthStore } from '../store/auth-store';

const AuthContext = createContext();

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

export const AuthProvider = ({ children }) => {
  const store = useAuthStore();

  // Initialize auth state on mount
  useEffect(() => {
    if (!store.isInitialized) {
      store.initializeAuth();
      const token = localStorage.getItem('fitme_token');
      if (token) store.getCurrentUser().catch(() => {});
    }
  }, []);

  const login = async (email, password) => {
    const result = await store.login(email, password);
    if (!result.success) return result;
    try {
      const userProfile = await store.getCurrentUser();
      if (!userProfile.profileCompleted) return { success: true, onboarding: true };
      return { success: true };
    } catch {
      return { success: true };
    }
  };

  const register = async (email, password, confirmPassword, firstName, lastName) => {
    if (password !== confirmPassword) return { success: false, message: 'Passwords do not match' };
    if (password.length < 6) return { success: false, message: 'Password must be at least 6 characters' };
    if (!firstName || !lastName) return { success: false, message: 'First name and last name are required' };

    const result = await store.register({ email, password, firstName, lastName });
    if (!result.success) return result;
    if (result.tokens?.accessToken) {
      await store.getCurrentUser().catch(() => {});
    }
    if (result.requiresEmailVerification) return { success: true, requiresEmailVerification: true };
    return { success: true, onboarding: true };
  };

  const value = {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    loading: store.loading,
    error: store.error,
    successMessage: store.successMessage,
    isInitialized: store.isInitialized,
    login,
    register,
    logout: store.logout,
    manualLogin: store.manualLogin,
    clearError: store.clearError,
    clearSuccessMessage: store.clearSuccessMessage,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
