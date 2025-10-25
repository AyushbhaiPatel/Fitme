const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const aicoachController = require('./aicoach.controller');
const { authenticate } = require('../../middleware/auth');

// Per-user chat limiter (runs after authenticate); falls back to IP. Options override windowMs/max for tests.
// standardHeaders also makes express-rate-limit v6 send Retry-After on 429.
const createChatLimiter = (options = {}) => rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.userId || req.user?._id || req.ip),
  message: { success: false, message: 'Too many chat requests. Try again in a minute.', errorCode: 'RATE_LIMITED' },
  ...options,
});

const chatLimiter = createChatLimiter();

router.get('/health', aicoachController.healthCheck);
router.post('/chat', authenticate, chatLimiter, aicoachController.chat);
router.get('/suggestions', authenticate, aicoachController.getSuggestions);

module.exports = router;
module.exports.createChatLimiter = createChatLimiter;
