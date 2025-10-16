module.exports = {
  feature: 'user',
  basePath: '/api/user',
  endpoints: [
    { method: 'PUT', path: '/profile', description: 'Update the user profile' },
    { method: 'PUT', path: '/profile-photo', description: 'Update the user profile photo' },
    { method: 'DELETE', path: '/profile-photo', description: 'Delete the user profile photo' },
    { method: 'DELETE', path: '/account', description: 'Delete the user account and all its data. Body: { password } (current password, required)' },
    { method: 'GET', path: '/stats', description: 'Get user statistics' },
    { method: 'PUT', path: '/email', description: 'Update the user email' },
    { method: 'GET', path: '/preferences', description: 'Get user preferences' },
  ],
};
