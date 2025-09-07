// All route path constants and route arrays

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  OTP_VERIFICATION: '/otp-verification',
  FORGOT_PASSWORD: '/forgot-password',
  ONBOARDING: '/onboarding',
  DASHBOARD: '/dashboard',
  WORKOUTS: '/dashboard/workouts',
  NUTRITION: '/dashboard/nutrition',
  AI_COACH: '/dashboard/ai-coach',
  PROGRESS: '/dashboard/progress',
  SETTINGS: '/dashboard/settings',
  PROFILE: '/dashboard/profile',
};

export const PUBLIC_ROUTE_PATHS = [
  ROUTES.HOME,
  ROUTES.LOGIN,
  ROUTES.REGISTER,
  ROUTES.OTP_VERIFICATION,
  ROUTES.FORGOT_PASSWORD,
];

export const PROTECTED_ROUTE_PATHS = [
  ROUTES.ONBOARDING,
  ROUTES.DASHBOARD,
  ROUTES.WORKOUTS,
  ROUTES.NUTRITION,
  ROUTES.AI_COACH,
  ROUTES.PROGRESS,
  ROUTES.SETTINGS,
  ROUTES.PROFILE,
];
