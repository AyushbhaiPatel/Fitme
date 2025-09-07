const { Format } = require('../../config/format');
const authDao = require('./auth.dao');
const { generateAccessToken, generateRefreshToken } = require('../../utils/jwt');
const OTPGenerator = require('../../utils/otpGenerator');
const emailService = require('../../utils/emailService');

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

const _sendOTPEmail = async (userId) => {
  const user = await authDao.findById(userId, '+emailOTP +otpExpiresAt +otpAttempts');
  if (!user) throw new Error('User not found');
  const otp = OTPGenerator.generateOTP();
  user.emailOTP = await OTPGenerator.hashOTP(otp);
  user.otpExpiresAt = OTPGenerator.getOTPExpiry();
  user.otpAttempts = 0;
  await authDao.saveUser(user);
  await emailService.sendOTPEmail(user.email, otp, user.firstName);
};

module.exports.register = async (payload) => {
  const { email, password, firstName, lastName, username } = payload;

  const existing = await authDao.findByEmail(email);
  if (existing) return Format.conflict('User with this email already exists');

  if (username) {
    const takenUsername = await authDao.findByUsername(username);
    if (takenUsername) return Format.conflict('Username is already taken');
  }

  const user = await authDao.createUser({
    email,
    password,
    firstName,
    lastName,
    username: username || email.split('@')[0],
    isEmailVerified: false,
  });

  try {
    await _sendOTPEmail(user._id);
  } catch (e) {
    console.error('OTP email failed:', e.message);
  }

  return Format.created(
    {
      user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, username: user.username, profileCompleted: user.profileCompleted, isEmailVerified: user.isEmailVerified },
      requiresEmailVerification: true,
    },
    'User registered successfully. Please check your email for verification code.'
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

  if (!user.isEmailVerified) {
    return Format.response(401, false, 'Please verify your email address before logging in', { userId: user._id, email: user.email });
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

module.exports.sendOTP = async (email) => {
  const user = await authDao.findByEmail(email, '+emailOTP +otpExpiresAt +otpAttempts');
  if (!user) return Format.notFound('No account found with this email address');
  if (user.isEmailVerified) return Format.badRequest('Email is already verified');
  if (user.otpAttempts >= 5) return Format.tooMany('Too many OTP requests. Please try again later.');
  if (user.otpExpiresAt && !OTPGenerator.isOTPExpired(user.otpExpiresAt)) {
    const timeRemaining = Math.ceil((user.otpExpiresAt - new Date()) / 1000);
    return Format.tooMany(`OTP already sent. Please wait ${timeRemaining} seconds.`);
  }
  await _sendOTPEmail(user._id);
  return Format.success({ email: user.email, expiresIn: '5 minutes' }, 'OTP sent successfully');
};

module.exports.verifyOTP = async ({ email, otp }) => {
  const user = await authDao.findByEmail(email, '+emailOTP +otpExpiresAt +otpAttempts');
  if (!user) return Format.notFound('No account found with this email address');
  if (user.isEmailVerified) return Format.badRequest('Email is already verified');
  if (!user.emailOTP || !user.otpExpiresAt) return Format.badRequest('No OTP found. Please request a new OTP.');
  if (OTPGenerator.isOTPExpired(user.otpExpiresAt)) return Format.badRequest('OTP has expired. Please request a new OTP.');
  if (user.otpAttempts >= 3) return Format.tooMany('Too many incorrect attempts. Please request a new OTP.');

  const valid = await OTPGenerator.verifyOTP(otp, user.emailOTP);
  if (!valid) {
    user.otpAttempts += 1;
    await authDao.saveUser(user);
    return Format.response(400, false, 'Invalid OTP. Please try again.', { attemptsRemaining: 3 - user.otpAttempts });
  }

  user.isEmailVerified = true;
  user.emailOTP = undefined;
  user.otpExpiresAt = undefined;
  user.otpAttempts = 0;
  await authDao.saveUser(user);

  try { await emailService.sendWelcomeEmail(user.email, user.firstName); } catch (e) { /* non-fatal */ }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  user.lastLoginAt = new Date();
  await authDao.saveUser(user);

  return Format.success(
    {
      user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, username: user.username, profileCompleted: user.profileCompleted, isEmailVerified: true, lastLoginAt: user.lastLoginAt },
      tokens: { accessToken, refreshToken },
    },
    'Email verified successfully! Welcome to FitMe!'
  );
};

module.exports.resendOTP = async (email) => {
  const user = await authDao.findByEmail(email, '+emailOTP +otpExpiresAt +otpAttempts');
  if (!user) return Format.notFound('No account found with this email address');
  if (user.isEmailVerified) return Format.badRequest('Email is already verified');
  await _sendOTPEmail(user._id);
  return Format.success({ email: user.email, expiresIn: '5 minutes' }, 'New OTP sent successfully');
};

module.exports.requestPasswordReset = async (email) => {
  const user = await authDao.findByEmail(email, '+passwordResetOTP +passwordResetExpiresAt +passwordResetAttempts +passwordResetLastSentAt');
  if (!user) return Format.notFound('No account found with this email address');

  const now = new Date();
  if (user.passwordResetLastSentAt) {
    const secs = Math.floor((now - user.passwordResetLastSentAt) / 1000);
    if (secs < 60) return Format.tooMany(`Please wait ${60 - secs} seconds before requesting a new code`);
  }
  if (user.passwordResetAttempts >= 5) return Format.tooMany('Too many password reset requests. Please try again later.');

  const otp = OTPGenerator.generateOTP();
  user.passwordResetOTP = await OTPGenerator.hashOTP(otp);
  user.passwordResetExpiresAt = OTPGenerator.getOTPExpiry();
  user.passwordResetAttempts = 0;
  user.passwordResetLastSentAt = now;
  await authDao.saveUser(user);
  await emailService.sendPasswordResetOTP(user.email, otp, user.firstName);

  return Format.success({ email: user.email, expiresIn: '5 minutes' }, 'Password reset code sent successfully');
};

module.exports.resetPasswordWithOTP = async ({ email, otp, password }) => {
  const user = await authDao.findByEmail(email, '+password +passwordResetOTP +passwordResetExpiresAt +passwordResetAttempts');
  if (!user) return Format.notFound('No account found with this email address');
  if (!user.passwordResetOTP || !user.passwordResetExpiresAt) return Format.badRequest('No password reset request found. Please request a new code.');
  if (OTPGenerator.isOTPExpired(user.passwordResetExpiresAt)) return Format.badRequest('OTP has expired. Please request a new code.');
  if (user.passwordResetAttempts >= 3) return Format.tooMany('Too many incorrect attempts. Please request a new code.');

  const valid = await OTPGenerator.verifyOTP(otp, user.passwordResetOTP);
  if (!valid) {
    user.passwordResetAttempts += 1;
    await authDao.saveUser(user);
    return Format.response(400, false, 'Invalid OTP. Please try again.', { attemptsRemaining: Math.max(0, 3 - user.passwordResetAttempts) });
  }

  const same = await user.comparePassword(password);
  if (same) return Format.badRequest('New password cannot be the same as your current password');

  user.password = password;
  user.passwordResetOTP = undefined;
  user.passwordResetExpiresAt = undefined;
  user.passwordResetAttempts = 0;
  await authDao.saveUser(user);

  return Format.success(null, 'Password has been reset successfully');
};
