const { Format } = require('../../config/format');
const userDao = require('./user.dao');
const accountDeletion = require('./user.deletion');
const { secondsToMinutes, userAverageSeconds, userTotalSeconds } = require('../workout/workout.duration');

// Allowlist: only these top-level keys are ever copied from the request body. Anything else
// (password, email, workout totals/history, streaks, `$`-operators, dotted paths) is dropped.
const PROFILE_FIELDS = [
  'firstName', 'lastName', 'username', 'dateOfBirth', 'gender', 'height', 'weight', 'activityLevel',
  'fitnessGoals', 'location', 'goalWeight', 'profilePhoto', 'bio', 'fitnessExperience', 'workoutFrequency',
  'workoutDuration', 'dietaryPreference', 'preferredWorkouts', 'targetMuscleGain', 'currentStrengthLevel',
];

module.exports.updateProfile = async (userId, updateData) => {
  const source = updateData && typeof updateData === 'object' ? updateData : {};
  const safeData = {};
  for (const key of PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) safeData[key] = source[key];
  }

  if (safeData.username) {
    const taken = await userDao.findByUsername(safeData.username, userId);
    if (taken) return Format.conflict('Username is already taken');
  }

  // Explicit $set so no request key can ever be interpreted as an update operator.
  const updatedUser = await userDao.updateById(userId, { $set: { ...safeData, profileCompleted: true } });
  if (!updatedUser) return Format.notFound('User not found');

  return Format.success({ user: updatedUser }, 'Profile updated successfully');
};

// Identity must be re-verified (current password) on every call; a bearer token alone is never enough.
// Order: dependent data first, user document last. If a dependent delete fails, the request errors,
// the account still exists and the password still works, so the user can retry (every step is an
// idempotent deleteMany). Deleting the user first would instead strand data with no way to retry.
module.exports.deleteAccount = async (userId, password) => {
  const user = await userDao.findByIdWithPassword(userId);
  if (!user) return Format.notFound('User not found');

  const rejected = await accountDeletion.verifyDeletionIdentity(user, { password });
  if (rejected) return rejected;

  await accountDeletion.deleteDependentData(userId);
  // null here means a concurrent request already removed it: the outcome the caller asked for.
  await userDao.deleteById(userId);

  // Best-effort sweep for rows written by requests that were already past authentication while
  // this ran. The account is gone either way, so a failure is logged rather than reported.
  try {
    await accountDeletion.deleteDependentData(userId);
  } catch (error) {
    console.error(`Account ${userId} deleted, but the follow-up data sweep failed:`, error.message);
  }

  return Format.success(null, 'Account deleted successfully');
};

module.exports.getUserStats = async (user) => {
  let bmi = null;
  if (user.height && user.weight) {
    const h = user.height / 100;
    bmi = parseFloat((user.weight / (h * h)).toFixed(1));
  }

  let bmr = null;
  if (user.height && user.weight && user.age && user.gender) {
    bmr = user.gender === 'male'
      ? Math.round(10 * user.weight + 6.25 * user.height - 5 * user.age + 5)
      : Math.round(10 * user.weight + 6.25 * user.height - 5 * user.age - 161);
  }

  const tdee = bmr ? Math.round(bmr * 1.2) : null;
  const accountAge = Math.floor((Date.now() - new Date(user.created_at || user.createdAt).getTime()) / 86400000);

  return Format.success({
    stats: {
      accountAge,
      profileCompleteness: user.isProfileComplete() ? 100 : 60,
      bmi,
      bmr,
      tdee,
      age: user.age,
      fitnessGoalsCount: user.fitnessGoals?.length || 0,
      totalWorkouts: user.totalWorkouts || 0,
      caloriesBurned: user.totalCaloriesBurned || 0,
      avgWorkout: secondsToMinutes(userAverageSeconds(user)),
      avgWorkoutSeconds: userAverageSeconds(user),
      totalWorkoutTimeSeconds: userTotalSeconds(user),
      longestStreak: user.longestStreak || 0,
      currentStreak: user.currentStreak || 0,
      achievements: user.achievements || 0,
    },
  });
};

module.exports.updateEmail = async (userId, { newEmail, password }) => {
  const user = await userDao.findByIdWithPassword(userId);
  if (!user) return Format.notFound('User not found');

  const valid = await user.comparePassword(password);
  if (!valid) return Format.badRequest('Incorrect password');

  const taken = await userDao.findByEmail(newEmail, userId);
  if (taken) return Format.conflict('Email is already taken');

  user.email = newEmail;
  await userDao.saveUser(user);

  return Format.success({ email: user.email }, 'Email updated successfully');
};

module.exports.getPreferences = async (user) => {
  return Format.success({
    preferences: { fitnessGoals: user.fitnessGoals, profileCompleted: user.profileCompleted },
  });
};

module.exports.updateProfilePhoto = async (userId, profilePhoto) => {
  if (!profilePhoto) return Format.badRequest('Profile photo data is required');

  if (!/^data:image\/(jpeg|jpg|png|gif|webp);base64,/.test(profilePhoto)) {
    return Format.badRequest('Invalid image format. Please use JPEG, PNG, GIF, or WebP');
  }

  const base64Data = profilePhoto.split(',')[1];
  if (!base64Data) return Format.badRequest('Invalid image data');

  const sizeInBytes = (base64Data.length * 3) / 4;
  if (sizeInBytes > 5 * 1024 * 1024) {
    return Format.badRequest(`Image must be under 5MB. Current size: ${(sizeInBytes / 1024 / 1024).toFixed(2)}MB`);
  }

  const updatedUser = await userDao.updateById(userId, { profilePhoto });
  if (!updatedUser) return Format.notFound('User not found');

  return Format.success({ user: updatedUser, photoSize: `${(sizeInBytes / 1024 / 1024).toFixed(2)}MB` }, 'Profile photo updated successfully');
};

module.exports.deleteProfilePhoto = async (userId) => {
  const updatedUser = await userDao.updateById(userId, { $unset: { profilePhoto: 1 } }, { new: true, runValidators: false });
  if (!updatedUser) return Format.notFound('User not found');
  return Format.success({ user: updatedUser }, 'Profile photo deleted successfully');
};
