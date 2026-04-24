module.exports = {
  feature: 'auth',
  basePath: '/api/auth',
  endpoints: [
    { method: 'POST', path: '/register', description: 'Register a new user account' },
    { method: 'POST', path: '/login', description: 'Authenticate a user and issue tokens' },
    { method: 'POST', path: '/refresh', description: 'Refresh access and refresh tokens' },
    { method: 'POST', path: '/logout', description: 'Logout the authenticated user' },
    { method: 'GET', path: '/me', description: 'Get the current authenticated user' },
    { method: 'PUT', path: '/change-password', description: 'Change the current password' },
    { method: 'GET', path: '/verify', description: 'Verify the active token' },
    { method: 'POST', path: '/send-otp', description: 'Send an email verification OTP' },
    { method: 'POST', path: '/verify-otp', description: 'Verify an email OTP' },
    { method: 'POST', path: '/resend-otp', description: 'Resend an email verification OTP' },
    { method: 'POST', path: '/forgot-password/request', description: 'Start password reset with OTP' },
    { method: 'POST', path: '/forgot-password/confirm', description: 'Reset password using OTP' },
  ],
};
