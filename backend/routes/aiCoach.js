const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { generateAIResponse, getSuggestedQuestions, healthCheck } = require('../controllers/aiCoachController');
const { authenticate } = require('../middleware/auth');

const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { success: false, message: 'Too many chat requests. Try again in a minute.' } });

// GET /api/aicoach/health - Health check (public)
router.get('/health', healthCheck);

// POST /api/aicoach/chat - Send message to AI Coach
router.post('/chat', authenticate, chatLimiter, generateAIResponse);

// GET /api/aicoach/suggestions - Get personalized question suggestions
router.get('/suggestions', authenticate, getSuggestedQuestions);

module.exports = router; 