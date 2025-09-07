const { Format } = require('../../config/format');
const userDao = require('./user.dao');

module.exports.updateProfile = async (userId, updateData) => {
  const { password, email, _id, createdAt, updatedAt, ...safeData } = updateData;

  if (safeData.username) {
    const taken = await userDao.findByUsername(safeData.username, userId);
    if (taken) return Format.conflict('Username is already taken');
  }

  const updatedUser = await userDao.updateById(userId, { ...safeData, profileCompleted: true });
  if (!updatedUser) return Format.notFound('User not found');

  return Format.success({ user: updatedUser }, 'Profile updated successfully');
};

module.exports.deleteAccount = async (userId, password) => {
  const user = await userDao.findByIdWithPassword(userId);
  if (!user) return Format.notFound('User not found');

  if (password) {
    const valid = await user.comparePassword(password);
    if (!valid) return Format.badRequest('Incorrect password');
  }

  await userDao.deleteById(userId);
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
      avgWorkout: user.averageWorkoutTimeMinutes || 0,
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
  user.isEmailVerified = false;
  await userDao.saveUser(user);

  return Format.success({ email: user.email, isEmailVerified: false }, 'Email updated successfully');
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
