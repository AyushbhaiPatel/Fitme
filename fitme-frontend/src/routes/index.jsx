// Central route config - maps paths to module components

import React, { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ROUTES } from './local-routes';

// Public pages
import HomePage from '../modules/home/components/home-page';
import Login from '../modules/auth/components/login';
import Register from '../modules/auth/components/register';
import EmailVerificationPage from '../modules/auth/components/email-verification-page';
import ForgotPassword from '../modules/auth/components/forgot-password';
import Onboarding from '../modules/onboarding/components/onboarding';

// Dashboard pages
import Dashboard from '../modules/dashboard/components/dashboard';
import Workouts from '../modules/workouts/components/workouts';
import Nutrition from '../modules/nutrition/components/nutrition';
import AiCoach from '../modules/ai-coach/components/ai-coach';
import Analytics from '../modules/analytics/components/analytics';
import AccountSettings from '../modules/account/components/account-settings';
import Profile from '../modules/profile/components/profile';

// Shared layout/guards
import ProtectedRoute from '../components/protected-route';
import DashboardLayout from '../components/dashboard-layout';
import ToastContainer from '../components/toast-container';
import { useToast } from '../hooks/use-toast';
import { useAuth } from '../context/auth-context';

const AppRoutes = () => {
  const { error, successMessage, clearError, clearSuccessMessage, isInitialized, loading } = useAuth();
  const { toasts, hideToast, showError, showSuccess } = useToast();

  useEffect(() => {
    if (error) { showError(error); clearError(); }
  }, [error, showError, clearError]);

  useEffect(() => {
    if (successMessage) { showSuccess(successMessage); clearSuccessMessage(); }
  }, [successMessage, showSuccess, clearSuccessMessage]);

  if (!isInitialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="font-sans scroll-smooth">
      <ToastContainer toasts={toasts} onHideToast={hideToast} />
      <Routes>
        {/* Public Routes */}
        <Route path={ROUTES.HOME} element={<HomePage />} />
        <Route path={ROUTES.LOGIN} element={<Login />} />
        <Route path={ROUTES.REGISTER} element={<Register />} />
        <Route path={ROUTES.OTP_VERIFICATION} element={<EmailVerificationPage />} />
        <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPassword />} />

        {/* Onboarding (protected, no profile required) */}
        <Route
          path={ROUTES.ONBOARDING}
          element={
            <ProtectedRoute requireCompleteProfile={false}>
              <Onboarding />
            </ProtectedRoute>
          }
        />

        {/* Protected Dashboard Routes */}
        <Route
          path={ROUTES.DASHBOARD}
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="workouts" element={<Workouts />} />
          <Route path="nutrition" element={<Nutrition />} />
          <Route path="ai-coach" element={<AiCoach />} />
          <Route path="progress" element={<Analytics />} />
          <Route path="settings" element={<AccountSettings />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Routes>
    </div>
  );
};

export default AppRoutes;
