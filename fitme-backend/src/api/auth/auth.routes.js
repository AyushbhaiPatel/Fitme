const router = require('express').Router();
const authController = require('./auth.controller');
const { authenticate, validateRefreshToken } = require('../../middleware/auth');
const {
  validateRegistration,
  validateLogin,
  validatePasswordChange,
  validateRefreshToken: validateRefreshTokenBody,
} = require('../../middleware/validation');

router.post('/register', validateRegistration, authController.register);
router.post('/login', validateLogin, authController.login);
router.post('/refresh', validateRefreshTokenBody, validateRefreshToken, authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);
router.put('/change-password', authenticate, validatePasswordChange, authController.changePassword);
router.get('/verify', authenticate, authController.verifyToken);

module.exports = router;
