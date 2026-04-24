const router = require('express').Router();
const userController = require('./user.controller');
const { authenticate } = require('../../middleware/auth');
const { validateProfileUpdate } = require('../../middleware/validation');

router.put('/profile', authenticate, validateProfileUpdate, userController.updateProfile);
router.put('/profile-photo', authenticate, userController.updateProfilePhoto);
router.delete('/profile-photo', authenticate, userController.deleteProfilePhoto);
router.delete('/account', authenticate, userController.deleteAccount);
router.get('/stats', authenticate, userController.getUserStats);
router.put('/email', authenticate, userController.updateEmail);
router.get('/preferences', authenticate, userController.getPreferences);

module.exports = router;
