import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { UNSCOPED_USER_KEYS, LAST_USER_ID_KEY, clearUnscopedUserData, syncSignedInUser } from './user-local-data.js';
import { UNSCOPED_USER_KEYS as ACCOUNT_KEYS } from '../modules/account/services/local-account-data.js';

const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()].sort(),
  };
};

const throwingStorage = () => {
  const fail = () => { throw new Error('SecurityError'); };
  return { getItem: fail, setItem: fail, removeItem: fail };
};

const seeded = (extra = {}) =>
  memoryStorage({ aicoach_messages: '[{"content":"A secret"}]', fitme_saved_plans: '[{"id":"p"}]', 'fitme:u1:x': '1', unrelated: 'keep', ...extra });

describe('clearUnscopedUserData', () => {
  test('removes the AI coach chat and saved plans and nothing else', () => {
    const storage = seeded({ fitme_token: 't' });
    clearUnscopedUserData(storage);
    assert.deepEqual(storage.keys(), ['fitme:u1:x', 'fitme_token', 'unrelated']);
  });

  test('never throws when storage is unavailable', () => {
    assert.doesNotThrow(() => clearUnscopedUserData(throwingStorage()));
  });

  test('account deletion uses the same key list', () => {
    assert.deepEqual(UNSCOPED_USER_KEYS, ['aicoach_messages', 'fitme_saved_plans']);
    assert.equal(ACCOUNT_KEYS, UNSCOPED_USER_KEYS);
  });
});

describe('syncSignedInUser', () => {
  test('a different user signing in clears the previous user’s unscoped data and is remembered', () => {
    const storage = seeded({ [LAST_USER_ID_KEY]: 'uA' });
    assert.equal(syncSignedInUser({ id: 'uB' }, storage), true);
    assert.equal(storage.getItem('aicoach_messages'), null);
    assert.equal(storage.getItem('fitme_saved_plans'), null);
    assert.equal(storage.getItem(LAST_USER_ID_KEY), 'uB');
    assert.equal(storage.getItem('unrelated'), 'keep');
  });

  test('the same user (reload, or /auth/me replacing the login user with _id) keeps their data', () => {
    const storage = seeded({ [LAST_USER_ID_KEY]: 'u1' });
    assert.equal(syncSignedInUser({ id: 'u1' }, storage), false);
    assert.equal(syncSignedInUser({ _id: 'u1' }, storage), false);
    assert.equal(syncSignedInUser({ id: 'u1', _id: 'u1' }, storage), false);
    assert.equal(storage.getItem('aicoach_messages'), '[{"content":"A secret"}]');
    assert.equal(storage.getItem('fitme_saved_plans'), '[{"id":"p"}]');
  });

  test('with no remembered user the data is of unknown owner, so it is cleared', () => {
    const storage = seeded();
    assert.equal(syncSignedInUser({ _id: 'u1' }, storage), true);
    assert.equal(storage.getItem('aicoach_messages'), null);
    assert.equal(storage.getItem(LAST_USER_ID_KEY), 'u1');
  });

  test('no user / no id is a no-op, and storage errors never throw', () => {
    const storage = seeded({ [LAST_USER_ID_KEY]: 'uA' });
    assert.equal(syncSignedInUser(null, storage), false);
    assert.equal(syncSignedInUser({}, storage), false);
    assert.equal(storage.getItem('aicoach_messages'), '[{"content":"A secret"}]');
    assert.doesNotThrow(() => syncSignedInUser({ id: 'u1' }, throwingStorage()));
  });
});
