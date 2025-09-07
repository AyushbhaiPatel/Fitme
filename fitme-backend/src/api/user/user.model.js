const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    },
    password: { type: String, required: [true, 'Password is required'], minlength: 6, select: false },
    firstName: { type: String, required: [true, 'First name is required'], trim: true, maxlength: 50 },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true, maxlength: 50 },
    username: { type: String, unique: true, sparse: true, trim: true, minlength: 3, maxlength: 30 },
    bio: { type: String, trim: true, maxlength: 1000, default: '' },
    profilePhoto: {
      type: String,
      validate: {
        validator(value) {
          if (!value) return true;
          if (!/^data:image\/(jpeg|jpg|png|gif|webp);base64,/.test(value)) return false;
          const base64Data = value.split(',')[1];
          return (base64Data.length * 3) / 4 <= 5 * 1024 * 1024;
        },
        message: 'Profile photo must be a valid image (JPEG, PNG, GIF, WebP) and under 5MB',
      },
    },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer-not-to-say'], default: 'prefer-not-to-say' },
    height: { type: Number, min: 50, max: 300 },
    weight: { type: Number, min: 20, max: 500 },
    activityLevel: {
      type: String,
      enum: ['sedentary', 'lightly-active', 'moderately-active', 'very-active', 'extremely-active'],
      default: 'sedentary',
    },
    fitnessGoals: [{ type: String, enum: ['weight-loss', 'weight-gain', 'muscle-gain', 'strength', 'general-fitness'] }],
    location: { type: String, trim: true, maxlength: 100 },
    goalWeight: { type: Number, min: 20, max: 500 },
    fitnessExperience: { type: String, enum: ['beginner', 'intermediate', 'advanced', 'expert'], default: 'beginner' },
    preferredWorkouts: { type: String, default: '' },
    workoutFrequency: { type: String, enum: ['2-3', '3-4', '4-5', '5-6', 'daily'], default: '2-3' },
    workoutDuration: { type: String, enum: ['15-30', '30-45', '45-60', '60-90', '90+'], default: '30-45' },
    dietaryPreference: {
      type: String,
      enum: ['No Restrictions', 'Vegetarian', 'Vegan', 'Keto', 'Paleo', 'Mediterranean', 'Low Carb', 'Gluten Free', 'Dairy Free', 'Intermittent Fasting', 'Pescatarian', 'Other'],
      default: 'No Restrictions',
    },
    targetMuscleGain: { type: Number, min: 0, max: 50 },
    currentStrengthLevel: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
    isEmailVerified: { type: Boolean, default: false },
    emailOTP: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    passwordResetOTP: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    passwordResetAttempts: { type: Number, default: 0, select: false },
    passwordResetLastSentAt: { type: Date, select: false },
    profileCompleted: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    totalWorkouts: { type: Number, default: 0 },
    totalCaloriesBurned: { type: Number, default: 0 },
    totalWorkoutTimeMinutes: { type: Number, default: 0 },
    averageWorkoutTimeMinutes: { type: Number, default: 0 },
    workoutHistory: [
      {
        workoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkoutPlan' },
        completedAt: { type: Date, default: Date.now },
        caloriesBurned: { type: Number, default: 0 },
        durationMinutes: { type: Number, default: 0 },
        workoutName: String,
        exercises: [{ name: String, completed: Boolean, caloriesBurned: Number }],
      },
    ],
    longestStreak: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    achievements: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isProfileComplete = function () {
  return ['firstName', 'lastName', 'dateOfBirth', 'gender', 'height', 'weight', 'activityLevel'].every(
    (f) => this[f] != null && this[f] !== ''
  );
};

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual('age').get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birth = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
});

module.exports = mongoose.model('User', userSchema);
