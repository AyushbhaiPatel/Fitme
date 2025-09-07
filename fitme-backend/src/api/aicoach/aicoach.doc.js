module.exports = {
  feature: 'aicoach',
  basePath: '/api/aicoach',
  endpoints: [
    { method: 'GET', path: '/health', description: 'AI coach service health status' },
    { method: 'POST', path: '/chat', description: 'Send a message to the AI coach' },
    { method: 'GET', path: '/suggestions', description: 'Get personalized AI coach suggestions' },
  ],
};
