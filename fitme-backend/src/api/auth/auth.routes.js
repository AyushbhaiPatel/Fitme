const router = require('express').Router();
const authController = require('./auth.controller');
const { authenticate, validateRefreshToken } = require('../../middleware/auth');
const {
  validateRegistration,
  validateLogin,
  validatePasswordChange,
  validateRefreshToken: validateRefreshTokenBody,
  validateOTP,
  validateEmailOTP,
  validatePasswordResetRequest,
  validatePasswordReset,
} = require('../../middleware/validation');

router.post('/register', validateRegistration, authController.register);
router.post('/login', validateLogin, authController.login);
router.post('/refresh', validateRefreshTokenBody, validateRefreshToken, authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);
router.put('/change-password', authenticate, validatePasswordChange, authController.changePassword);
router.get('/verify', authenticate, authController.verifyToken);
router.post('/send-otp', validateEmailOTP, authController.sendOTP);
router.post('/verify-otp', validateOTP, authController.verifyOTP);
router.post('/resend-otp', validateEmailOTP, authController.resendOTP);
router.post('/forgot-password/request', validatePasswordResetRequest, authController.requestPasswordReset);
router.post('/forgot-password/confirm', validatePasswordReset, authController.resetPasswordWithOTP);

module.exports = router;
