const mongoose = require('mongoose');

const exerciseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  sets: { type: Number },
  reps: { type: mongoose.Schema.Types.Mixed },
  rounds: { type: Number },
  duration_minutes: { type: Number },
  duration_seconds: { type: Number },
  rest_between_sets_seconds: { type: Number },
  description: { type: String },
  calories_burned: { type: Number, default: 0 },
});

const daySchema = new mongoose.Schema({
  day: { type: String, required: true },
  workout_type: { type: String, required: true },
  estimated_calories_burned: { type: Number, default: 0 },
  exercises: [exerciseSchema],
});

const workoutPlanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    goal: { type: String, required: true },
    duration_per_day_minutes: { type: Number, default: 30 },
    preference: [{ type: String }],
    days: [daySchema],
    isAIGenerated: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    totalCaloriesBurned: { type: Number, default: 0 },
    lastUsed: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

workoutPlanSchema.pre('save', function (next) {
  if (this.days?.length > 0) {
    this.totalCaloriesBurned = this.days.reduce((t, d) => t + (d.estimated_calories_burned || 0), 0);
  }
  next();
});

workoutPlanSchema.methods.markAsUsed = function () {
  this.lastUsed = new Date();
  return this.save();
};

workoutPlanSchema.methods.setAsActive = async function () {
  await this.constructor.updateMany({ userId: this.userId, _id: { $ne: this._id } }, { isActive: false });
  this.isActive = true;
  return this.save();
};

workoutPlanSchema.statics.getActivePlan = function (userId) {
  return this.findOne({ userId, isActive: true });
};

workoutPlanSchema.statics.getUserPlans = function (userId, options = {}) {
  const query = this.find({ userId });
  if (options.limit) query.limit(options.limit);
  query.sort(options.sort || { created_at: -1 });
  return query;
};

module.exports = mongoose.model('WorkoutPlan', workoutPlanSchema);
