// Account deletion: identity re-verification, a per-user attempt limiter, and removal of the
// user's data across collections. Other modules' models are only read here (never modified).
const { Format } = require('../../config/format');
const workoutDao = require('../workout/workout.dao');
const WorkoutPlan = require('../workout/workout.model');
const MealPlan = require('../mealplan/mealplan.model');
const AICoachInteraction = require('../aicoach/aicoach.model');

const MSG = {
  PASSWORD_REQUIRED: 'Password is required to delete your account',
  INCORRECT_PASSWORD: 'Incorrect password',
  REAUTH_REQUIRED: 'This account has no password, so it cannot be deleted here. Please sign in again to re-authenticate, then retry.',
  LOCKED: (minutes) => `Too many incorrect password attempts. Try again in ${minutes} minutes.`,
};

const fail = (code, message, errorCode) => ({ code, success: false, message, errorCode });

// --- Failed-attempt limiter (same pattern as login in auth.service.js), keyed by user id. ---
// In-memory and per process: enough to stop a stolen session from guessing the password.
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000;

const lockStatus = (key) => {
  const a = failedAttempts.get(key);
  if (!a) return null;
  const elapsed = Date.now() - a.lastAttempt;
  if (elapsed >= LOCKOUT_TIME) {
    failedAttempts.delete(key);
    return null;
  }
  return a.count >= MAX_ATTEMPTS ? { minutes: Math.ceil((LOCKOUT_TIME - elapsed) / 60000) } : null;
};

const recordFailure = (key) => {
  const a = failedAttempts.get(key) || { count: 0, lastAttempt: 0 };
  a.count += 1;
  a.lastAttempt = Date.now();
  failedAttempts.set(key, a);
};

const resetAttempts = (key) => (key === undefined ? failedAttempts.clear() : failedAttempts.delete(String(key)));

// --- Identity verification ---
// bcrypt hash produced by the User pre-save hook. Anything else (absent, empty, foreign format)
// is not a usable password and must never be compared against or treated as "verified".
const BCRYPT_HASH = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const hasPasswordHash = (user) => typeof user?.password === 'string' && BCRYPT_HASH.test(user.password);

/**
 * Returns null when the caller proved they own `user`, otherwise the error response to send.
 * Verification methods are tried in order; add new ones (e.g. a recent OAuth re-auth timestamp)
 * as further branches. Falling through every method is always a rejection, never a deletion.
 */
const verifyDeletionIdentity = async (user, { password } = {}) => {
  const key = String(user._id);

  if (hasPasswordHash(user)) {
    if (typeof password !== 'string' || password.length === 0) {
      return fail(400, MSG.PASSWORD_REQUIRED, 'PASSWORD_REQUIRED');
    }
    const locked = lockStatus(key);
    if (locked) return fail(429, MSG.LOCKED(locked.minutes), 'TOO_MANY_ATTEMPTS');

    if (!(await user.comparePassword(password))) {
      recordFailure(key);
      return fail(400, MSG.INCORRECT_PASSWORD, 'INCORRECT_PASSWORD');
    }
    resetAttempts(key);
    return null;
  }

  // Future: accept a recent re-authentication (e.g. `reauthenticatedAt` within N minutes) here.
  return fail(403, MSG.REAUTH_REQUIRED, 'REAUTH_REQUIRED');
};

// --- Data removal ---
// Every query is filtered on the authenticated user's id only. deleteMany is idempotent, so a
// failed run can simply be retried. Embedded workout history lives on the user document.
const deleteDependentData = async (userId) => {
  await workoutDao.deleteSessionsForUser(userId);
  await WorkoutPlan.deleteMany({ userId });
  await MealPlan.deleteMany({ userId });
  await AICoachInteraction.deleteMany({ userId });
};

module.exports = {
  MSG,
  MAX_ATTEMPTS,
  hasPasswordHash,
  verifyDeletionIdentity,
  deleteDependentData,
  resetAttempts,
};
