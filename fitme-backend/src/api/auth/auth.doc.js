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
  ],
};
