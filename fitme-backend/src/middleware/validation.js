const { body, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg, value: e.value })),
    });
  }
  next();
};

const validateRegistration = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('Password must include at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('Password must include at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must include at least one number')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must include at least one special character'),
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters').matches(/^[a-zA-Z\s]+$/).withMessage('First name can only contain letters and spaces'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters').matches(/^[a-zA-Z\s]+$/).withMessage('Last name can only contain letters and spaces'),
  body('username').optional().trim().isLength({ min: 3, max: 30 }).withMessage('Username must be between 3 and 30 characters').matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  handleValidationErrors,
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

const validatePasswordResetRequest = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  handleValidationErrors,
];

const validatePasswordReset = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  body('otp').notEmpty().withMessage('OTP is required').isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits').matches(/^[0-9]{6}$/).withMessage('OTP must contain only numbers'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('Password must include at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('Password must include at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must include at least one number')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must include at least one special character'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
  handleValidationErrors,
];

const validateProfileUpdate = [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters').matches(/^[a-zA-Z\s]+$/).withMessage('First name can only contain letters and spaces'),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters').matches(/^[a-zA-Z\s]+$/).withMessage('Last name can only contain letters and spaces'),
  body('username').optional().trim().isLength({ min: 3, max: 30 }).withMessage('Username must be between 3 and 30 characters').matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  body('dateOfBirth').optional().isISO8601().withMessage('Date of birth must be a valid date').custom((value) => {
    const age = new Date().getFullYear() - new Date(value).getFullYear();
    if (age < 13 || age > 120) throw new Error('Age must be between 13 and 120 years');
    return true;
  }),
  body('gender').optional().isIn(['male', 'female', 'other', 'prefer-not-to-say']).withMessage('Invalid gender value'),
  body('height').optional().isFloat({ min: 50, max: 300 }).withMessage('Height must be between 50 and 300 cm'),
  body('weight').optional().isFloat({ min: 20, max: 500 }).withMessage('Weight must be between 20 and 500 kg'),
  body('fitnessGoals').optional().isArray().withMessage('Fitness goals must be an array').custom((goals) => {
    const valid = ['weight-loss', 'weight-gain', 'muscle-gain', 'strength', 'general-fitness'];
    const invalid = goals.filter(g => !valid.includes(g));
    if (invalid.length > 0) throw new Error(`Invalid fitness goals: ${invalid.join(', ')}`);
    return true;
  }),
  body('location').optional().trim().isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters'),
  body('goalWeight').optional().isFloat({ min: 20, max: 500 }).withMessage('Goal weight must be between 20 and 500 kg').custom((goalWeight, { req }) => {
    const cw = parseFloat(req.body?.weight);
    const gw = parseFloat(goalWeight);
    const goals = Array.isArray(req.body?.fitnessGoals) ? req.body.fitnessGoals : [];
    if (!isNaN(gw) && !isNaN(cw)) {
      if (gw === cw) throw new Error('Goal weight must be different from current weight');
      if (goals.includes('weight-gain') && gw <= cw) throw new Error('For weight gain, goal weight must be greater than current weight');
      if (goals.includes('weight-loss') && gw >= cw) throw new Error('For weight loss, goal weight must be less than current weight');
    }
    return true;
  }),
  body('profilePhoto').optional().custom((value) => {
    if (!value) return true;
    if (!/^data:image\/(jpeg|jpg|png|gif|webp);base64,/.test(value)) throw new Error('Profile photo must be a valid image data URI');
    const base64Data = value.split(',')[1];
    if (!base64Data) throw new Error('Invalid base64 image data');
    if ((base64Data.length * 3) / 4 > 5 * 1024 * 1024) throw new Error('Profile photo must be under 5MB');
    return true;
  }),
  body('bio').optional().isString().isLength({ max: 1000 }).withMessage('Bio cannot exceed 1000 characters'),
  body('fitnessExperience').optional().isIn(['beginner', 'intermediate', 'advanced', 'expert']).withMessage('Invalid fitness experience value'),
  body('workoutFrequency').optional().isIn(['2-3', '3-4', '4-5', '5-6', 'daily']).withMessage('Invalid workout frequency value'),
  body('workoutDuration').optional().isIn(['15-30', '30-45', '45-60', '60-90', '90+']).withMessage('Invalid workout duration value'),
  body('dietaryPreference').optional().isIn(['No Restrictions', 'Vegetarian', 'Vegan', 'Keto', 'Paleo', 'Mediterranean', 'Low Carb', 'Gluten Free', 'Dairy Free', 'Intermittent Fasting', 'Pescatarian', 'Other']).withMessage('Invalid dietary preference'),
  body('preferredWorkouts').optional().isString().isLength({ max: 500 }).withMessage('Preferred workouts cannot exceed 500 characters'),
  body('targetMuscleGain').optional().isFloat({ min: 0, max: 50 }).withMessage('Target muscle gain must be between 0 and 50 kg'),
  body('currentStrengthLevel').optional().isIn(['Beginner', 'Intermediate', 'Advanced']).withMessage('Invalid strength level'),
  handleValidationErrors,
];

const validatePasswordChange = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('New password must include at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('New password must include at least one uppercase letter')
    .matches(/[0-9]/).withMessage('New password must include at least one number')
    .matches(/[^A-Za-z0-9]/).withMessage('New password must include at least one special character'),
  body('confirmNewPassword').custom((value, { req }) => {
    if (value !== req.body.newPassword) throw new Error('New passwords do not match');
    return true;
  }),
  handleValidationErrors,
];

const validateRefreshToken = [
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
  handleValidationErrors,
];

const validateEmailOTP = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  handleValidationErrors,
];

const validateOTP = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  body('otp').notEmpty().withMessage('OTP is required').isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits').matches(/^[0-9]{6}$/).withMessage('OTP must contain only numbers'),
  handleValidationErrors,
];

module.exports = {
  validateRegistration,
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordReset,
  validateProfileUpdate,
  validatePasswordChange,
  validateRefreshToken,
  validateEmailOTP,
  validateOTP,
  handleValidationErrors,
};
