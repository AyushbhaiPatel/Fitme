const aiCoachService = require('../services/aiCoachService');
const { isAvailable } = require('../services/geminiClient');

/**
 * POST /api/aicoach/chat
 */
const generateAIResponse = async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const result = await aiCoachService.chat(message, conversationHistory, req.user);
    res.json(result);
  } catch (error) {
    console.error('AI Coach chat error:', error.message);

    if (error.message?.includes('API_KEY_INVALID')) {
      return res.status(500).json({ success: false, message: 'Invalid API key configuration' });
    }
    if (error.message?.includes('RATE_LIMIT_EXCEEDED')) {
      return res.status(429).json({ success: false, message: 'AI service rate limit exceeded. Please try again later.' });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to generate AI response',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

/**
 * GET /api/aicoach/suggestions
 */
const getSuggestedQuestions = async (req, res) => {
  try {
    const suggestions = aiCoachService.getSuggestions(req.user);
    res.json({ success: true, suggestions });
  } catch (error) {
    console.error('Suggestions error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to get suggestions' });
  }
};

/**
 * GET /api/aicoach/health
 */
const healthCheck = (req, res) => {
  res.json({
    success: true,
    status: isAvailable() ? 'healthy' : 'degraded',
    geminiAvailable: isAvailable(),
    timestamp: new Date().toISOString(),
  });
};

module.exports = { generateAIResponse, getSuggestedQuestions, healthCheck };
