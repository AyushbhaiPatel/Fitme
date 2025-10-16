// Browser-side data that belongs to a signed-in user and must go when the account is deleted.
// Pure (takes the storage object) so it can be unit-tested without a DOM.
import { UNSCOPED_USER_KEYS } from '../../../utils/user-local-data.js';

// Session keys written by the auth store / axios client.
export const SESSION_KEYS = ['fitme_token', 'fitme_refresh_token', 'fitme_user'];

// Unscoped keys that hold the signed-in user's own data (AI coach chat, locally saved workout plans).
export { UNSCOPED_USER_KEYS };

// Ids the cached user may be stored under (login returns `id`, /auth/me returns `_id`).
export const cachedUserIds = (storage, user) => {
  const ids = new Set();
  const add = (u) => {
    for (const id of [u?.id, u?._id]) if (id) ids.add(String(id));
  };
  add(user);
  try {
    add(JSON.parse(storage.getItem('fitme_user') || 'null'));
  } catch {
    // unreadable cache: fall back to the ids we already have
  }
  return [...ids];
};

// Removes the session, the cached user, every `fitme:<userId>:` key for the given ids, and the
// unscoped user-data keys. Other users' `fitme:<otherId>:` keys are left alone. Returns removed keys.
export const clearAccountLocalData = (storage, userIds) => {
  const prefixes = userIds.filter(Boolean).map((id) => `fitme:${id}:`);
  const keys = [];
  for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));

  const doomed = keys.filter(
    (k) => SESSION_KEYS.includes(k) || UNSCOPED_USER_KEYS.includes(k) || prefixes.some((p) => k.startsWith(p))
  );
  doomed.forEach((k) => storage.removeItem(k));
  return doomed;
};
