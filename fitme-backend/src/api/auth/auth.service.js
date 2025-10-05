const crypto = require('crypto');
const { Format } = require('../../config/format');
const authDao = require('./auth.dao');
const { generateAccessToken, generateRefreshToken } = require('../../utils/jwt');
const { mapError } = require('../../middleware/error-handler');

// Failed login tracker
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000;

const _isLocked = (email) => {
  const a = failedAttempts.get(email);
  if (!a) return false;
  const now = Date.now();
  if (a.count >= MAX_ATTEMPTS && now - a.lastAttempt < LOCKOUT_TIME) {
    return { locked: true, timeRemaining: Math.ceil((LOCKOUT_TIME - (now - a.lastAttempt)) / 60000) };
  }
  if (now - a.lastAttempt >= LOCKOUT_TIME) failedAttempts.delete(email);
  return false;
};

const _recordFail = (email) => {
  const now = Date.now();
  const a = failedAttempts.get(email) || { count: 0, lastAttempt: now };
  a.count += 1;
  a.lastAttempt = now;
  failedAttempts.set(email, a);
  return { count: a.count, remaining: MAX_ATTEMPTS - a.count };
};

const _clearFail = (email) => failedAttempts.delete(email);

// Must match the User schema's username minlength/maxlength.
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;

const _withSuffix = (base, suffix) => `${base.slice(0, USERNAME_MAX - suffix.length)}${suffix}`;

// The username is internal (not shown in the UI), so derive one that always fits the schema
// instead of rejecting a valid email: truncate long local parts, pad short ones, and add a
// random suffix when the name is already taken.
const _deriveUsername = async (email) => {
  let base = String(email).split('@')[0].trim().slice(0, USERNAME_MAX);
  if (base.length < USERNAME_MIN) base = `${base}_user`;

  if (!(await authDao.findByUsername(base))) return base;
  for (let i = 0; i < 5; i++) {
    const candidate = _withSuffix(base, `_${crypto.randomInt(1000, 10000)}`);
    if (!(await authDao.findByUsername(candidate))) return candidate;
  }
  return _withSuffix(base, `_${crypto.randomBytes(4).toString('hex')}`);
};

// Safety net: schema validation and unique-index errors are client errors, not 500s.
const _mapPersistenceError = (error) => {
  // Shared mapper builds messages that never echo submitted values (Mongoose defaults do).
  if (error?.name === 'ValidationError' && error.errors) return mapError(error);
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0];
    if (field === 'username') return Format.conflict('Username is already taken');
    return Format.conflict('User with this email already exists');
  }
  return null;
};

module.exports.register = async (payload) => {
  const { email, password, firstName, lastName, username } = payload || {};
  if (!email || !password || !firstName || !lastName) {
    return Format.badRequest('Email, password, first name and last name are required');
  }

  const existing = await authDao.findByEmail(email);
  if (existing) return Format.conflict('User with this email already exists');

  if (username) {
    const takenUsername = await authDao.findByUsername(username);
    if (takenUsername) return Format.conflict('Username is already taken');
  }

  let user;
  try {
    user = await authDao.createUser({
      email,
      password,
      firstName,
      lastName,
      username: username || (await _deriveUsername(email)),
      lastLoginAt: new Date(),
    });
  } catch (error) {
    const mapped = _mapPersistenceError(error);
    if (mapped) return mapped;
    throw error;
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return Format.created(
    {
      user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, username: user.username, profileCompleted: user.profileCompleted, lastLoginAt: user.lastLoginAt },
      tokens: { accessToken, refreshToken },
    },
    'User registered successfully'
  );
};

module.exports.login = async ({ email, password }) => {
  if (!email || !password) return Format.badRequest('Email and password are required');

  const lockStatus = _isLocked(email);
  if (lockStatus?.locked) {
    return Format.tooMany(`Account temporarily locked. Try again in ${lockStatus.timeRemaining} minutes.`);
  }

  const user = await authDao.findByEmail(email, '+password');
  if (!user) {
    _recordFail(email);
    return Format.response(401, false, 'No account found with this email address');
  }

  const valid = await user.comparePassword(password);
  if (!valid) {
    const info = _recordFail(email);
    return Format.response(401, false, `Incorrect password. ${info.remaining} attempts remaining.`);
  }

  _clearFail(email);
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  user.lastLoginAt = new Date();
  await authDao.saveUser(user);

  return Format.success(
    {
      user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, username: user.username, profileCompleted: user.profileCompleted, lastLoginAt: user.lastLoginAt },
      tokens: { accessToken, refreshToken },
    },
    'Login successful'
  );
};

module.exports.refreshToken = async (user) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  return Format.success({ tokens: { accessToken, refreshToken } }, 'Token refreshed successfully');
};

module.exports.logout = async () => {
  return Format.success(null, 'Logout successful');
};

module.exports.getMe = async (userId) => {
  const user = await authDao.findById(userId);
  if (!user) return Format.notFound('User not found');
  return Format.success({ user });
};

module.exports.changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await authDao.findById(userId, '+password');
  if (!user) return Format.notFound('User not found');

  const valid = await user.comparePassword(currentPassword);
  if (!valid) return Format.response(401, false, 'Current password is incorrect');

  const same = await user.comparePassword(newPassword);
  if (same) return Format.badRequest('New password cannot be the same as your current password');

  user.password = newPassword;
  await authDao.saveUser(user);
  return Format.success(null, 'Password changed successfully');
};

module.exports.verifyToken = async (user) => {
  return Format.success({ user }, 'Token is valid');
};
