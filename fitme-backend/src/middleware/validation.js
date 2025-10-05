const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const list = errors.array({ onlyFirstError: true }).map((e) => {
      // express-validator v6 names the field `param`; v7 renamed it to `path`.
      const field = e.path ?? e.param;
      const item = { field, message: e.msg };
      // Never echo secrets back to the client, nor large/structured payloads (e.g. base64 photos).
      const echoable = e.value === null || ['number', 'boolean'].includes(typeof e.value)
        || (typeof e.value === 'string' && e.value.length <= 200);
      if (!/password|token/i.test(field || '') && echoable) item.value = e.value;
      return item;
    });
    return res.status(400).json({
      code: 400,
      success: false,
      message: list[0]?.message || 'Validation failed',
      errors: list,
    });
  }
  next();
};

// Registration rules. Keep in sync with fitme-frontend/src/modules/auth/components/register.jsx.
const EMAIL_MAX_LENGTH = 254;

const validateRegistration = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required').bail()
    .isLength({ max: EMAIL_MAX_LENGTH }).withMessage(`Email must be at most ${EMAIL_MAX_LENGTH} characters`).bail()
    .isEmail().withMessage('Please provide a valid email address').bail()
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required').bail()
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('Password must include at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('Password must include at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must include at least one number')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must include at least one special character'),
  body('firstName').trim().notEmpty().withMessage('First name is required').bail().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters').matches(/^[a-zA-Z\s]+$/).withMessage('First name can only contain letters and spaces'),
  body('lastName').trim().notEmpty().withMessage('Last name is required').bail().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters').matches(/^[a-zA-Z\s]+$/).withMessage('Last name can only contain letters and spaces'),
  body('username').optional().trim().isLength({ min: 3, max: 30 }).withMessage('Username must be between 3 and 30 characters').matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  handleValidationErrors,
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  body('password').notEmpty().withMessage('Password is required').bail().isString().withMessage('Password must be a string'),
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
  body('activityLevel').optional().isIn(['sedentary', 'lightly-active', 'moderately-active', 'very-active', 'extremely-active']).withMessage('Invalid activity level value'),
  body('fitnessGoals').optional().isArray().withMessage('Fitness goals must be an array').bail().custom((goals) => {
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
  body('bio').optional().isString().withMessage('Bio must be text').bail().isLength({ max: 1000 }).withMessage('Bio cannot exceed 1000 characters'),
  body('fitnessExperience').optional().isIn(['beginner', 'intermediate', 'advanced', 'expert']).withMessage('Invalid fitness experience value'),
  body('workoutFrequency').optional().isIn(['2-3', '3-4', '4-5', '5-6', 'daily']).withMessage('Invalid workout frequency value'),
  body('workoutDuration').optional().isIn(['15-30', '30-45', '45-60', '60-90', '90+']).withMessage('Invalid workout duration value'),
  body('dietaryPreference').optional().isIn(['No Restrictions', 'Vegetarian', 'Vegan', 'Keto', 'Paleo', 'Mediterranean', 'Low Carb', 'Gluten Free', 'Dairy Free', 'Intermittent Fasting', 'Pescatarian', 'Other']).withMessage('Invalid dietary preference'),
  body('preferredWorkouts').optional().isString().withMessage('Preferred workouts must be text').bail().isLength({ max: 500 }).withMessage('Preferred workouts cannot exceed 500 characters'),
  body('targetMuscleGain').optional().isFloat({ min: 0, max: 50 }).withMessage('Target muscle gain must be between 0 and 50 kg'),
  body('currentStrengthLevel').optional().isIn(['Beginner', 'Intermediate', 'Advanced']).withMessage('Invalid strength level'),
  handleValidationErrors,
];

const validatePasswordChange = [
  body('currentPassword').notEmpty().withMessage('Current password is required').bail().isString().withMessage('Current password must be a string'),
  body('newPassword')
    .isString().withMessage('New password must be a string').bail()
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

const validateEmailUpdate = [
  body('newEmail').isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
  body('password').notEmpty().withMessage('Password is required').bail().isString().withMessage('Password must be a string'),
  handleValidationErrors,
];

// The current password is mandatory: a bearer token alone must never be enough to delete an account.
const validateAccountDeletion = [
  body('password')
    .exists({ checkNull: true }).withMessage('Password is required to delete your account').bail()
    .isString().withMessage('Password must be a string').bail()
    .notEmpty().withMessage('Password is required to delete your account'),
  handleValidationErrors,
];

const validateProfilePhotoUpdate = [
  body('profilePhoto')
    .exists({ checkFalsy: true }).withMessage('Profile photo data is required').bail()
    .isString().withMessage('Invalid image format. Please use JPEG, PNG, GIF, or WebP'),
  handleValidationErrors,
];

// Rejects malformed ObjectIds in route params up front (otherwise Mongoose throws a CastError).
const validateObjectIdParam = (name, label = 'id') => [
  param(name).isMongoId().withMessage(`Invalid ${label}`),
  handleValidationErrors,
];

// Meal plan payloads. Fields may be sent at the top level or under `user_profile`.
const MEALPLAN_TEXT_MAX = 100;
const MEALPLAN_LIST_MAX = 20;
const mp = (field) => [field, `user_profile.${field}`];
const isStringList = (label) => (value) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > MEALPLAN_LIST_MAX) throw new Error(`${label} cannot have more than ${MEALPLAN_LIST_MAX} items`);
  if (!value.every((v) => typeof v === 'string' && v.length <= MEALPLAN_TEXT_MAX)) {
    throw new Error(`${label} must only contain text up to ${MEALPLAN_TEXT_MAX} characters`);
  }
  return true;
};
const mpText = (field, label) =>
  body(mp(field)).optional({ nullable: true })
    .isString().withMessage(`${label} must be text`).bail()
    .isLength({ max: MEALPLAN_TEXT_MAX }).withMessage(`${label} cannot exceed ${MEALPLAN_TEXT_MAX} characters`);

const validateMealPlanGenerate = [
  body('user_profile').optional({ nullable: true }).isObject().withMessage('user_profile must be an object'),
  body(mp('age')).optional({ nullable: true }).isFloat({ min: 13, max: 120 }).withMessage('Age must be between 13 and 120'),
  body(mp('weight')).optional({ nullable: true }).isFloat({ min: 20, max: 500 }).withMessage('Weight must be between 20 and 500 kg'),
  body(mp('height')).optional({ nullable: true }).isFloat({ min: 50, max: 300 }).withMessage('Height must be between 50 and 300 cm'),
  body(mp('max_prep_time')).optional({ nullable: true }).isInt({ min: 5, max: 240 }).withMessage('Max prep time must be between 5 and 240 minutes'),
  mpText('gender', 'Gender'),
  mpText('activity_level', 'Activity level'),
  mpText('fitness_goal', 'Fitness goal'),
  mpText('cooking_skill', 'Cooking skill'),
  mpText('meal_focus', 'Meal focus'),
  mpText('budget_range', 'Budget range'),
  body(mp('dietary_preferences')).optional({ nullable: true }).custom(isStringList('Dietary preferences')),
  body(mp('allergies')).optional({ nullable: true }).custom(isStringList('Allergies')),
  body(mp('disliked_foods')).optional({ nullable: true }).custom(isStringList('Disliked foods')),
  body(mp('preferred_cuisines')).optional({ nullable: true }).custom(isStringList('Preferred cuisines')),
  handleValidationErrors,
];

const validateMealPlanList = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be an integer between 1 and 100'),
  query('skip').optional().isInt({ min: 0 }).withMessage('skip must be a non-negative integer'),
  handleValidationErrors,
];

const validateNutritionAnalyze = [
  body('food_items').custom((items) => {
    if (!Array.isArray(items) || items.length === 0) throw new Error('food_items array is required');
    if (items.length > 50) throw new Error('food_items cannot have more than 50 items');
    if (!items.every((i) => typeof i === 'string' && i.trim() && i.length <= 200)) {
      throw new Error('Each food item must be non-empty text up to 200 characters');
    }
    return true;
  }),
  body('portions').optional({ nullable: true }).isArray({ max: 50 }).withMessage('portions must be an array'),
  handleValidationErrors,
];

const validateRefreshToken = [
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
  handleValidationErrors,
];

module.exports = {
  validateRegistration,
  validateLogin,
  validateProfileUpdate,
  validatePasswordChange,
  validateEmailUpdate,
  validateRefreshToken,
  validateAccountDeletion,
  validateProfilePhotoUpdate,
  validateObjectIdParam,
  validateMealPlanGenerate,
  validateMealPlanList,
  validateNutritionAnalyze,
  handleValidationErrors,
};
