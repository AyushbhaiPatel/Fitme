// Unscoped localStorage keys that hold the signed-in user's own data (AI coach chat, locally
// saved workout plans). They are not keyed by user, so they must go whenever a session ends
// in this browser or a different user signs in. Pure (takes the storage object) for node:test.

export const UNSCOPED_USER_KEYS = ['aicoach_messages', 'fitme_saved_plans'];

// Id of the last user whose data the unscoped keys may hold.
export const LAST_USER_ID_KEY = 'fitme_last_user_id';

// Never throws: a storage failure must not break logout.
export const clearUnscopedUserData = (storage = globalThis.localStorage) => {
  for (const key of UNSCOPED_USER_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // storage unavailable: nothing to clear
    }
  }
};

// Call before any page reads the unscoped keys. If the signed-in user differs from the last one
// remembered (or none is remembered), clears the unscoped keys and remembers this user.
// Login returns `id`, /auth/me returns `_id`: either matching counts as the same user.
// Returns true when it cleared.
export const syncSignedInUser = (user, storage = globalThis.localStorage) => {
  const ids = [user?.id, user?._id].filter(Boolean).map(String);
  if (ids.length === 0) return false;
  try {
    if (ids.includes(storage.getItem(LAST_USER_ID_KEY))) return false;
    clearUnscopedUserData(storage);
    storage.setItem(LAST_USER_ID_KEY, ids[0]);
    return true;
  } catch {
    // storage unavailable: nothing persisted to leak
    return false;
  }
};
