const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const aicoachController = require('./aicoach.controller');
const { authenticate } = require('../../middleware/auth');

const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { success: false, message: 'Too many chat requests. Try again in a minute.' } });

router.get('/health', aicoachController.healthCheck);
router.post('/chat', authenticate, chatLimiter, aicoachController.chat);
router.get('/suggestions', authenticate, aicoachController.getSuggestions);

module.exports = router;
