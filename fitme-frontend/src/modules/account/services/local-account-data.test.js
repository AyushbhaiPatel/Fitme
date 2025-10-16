import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cachedUserIds, clearAccountLocalData } from './local-account-data.js';

const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()].sort(),
  };
};

describe('clearAccountLocalData', () => {
  test("removes the session, cached user and only that user's fitme:<id>: keys", () => {
    const storage = memoryStorage({
      fitme_token: 't',
      fitme_refresh_token: 'r',
      fitme_user: JSON.stringify({ id: 'u1' }),
      'fitme:u1:nutrition_log_2026-11-14': '[]',
      'fitme:u1:fitme_current_meal_plan': '{}',
      'fitme:u10:nutrition_log_2026-11-14': '[]',
      'fitme:u2:nutrition_log_2026-11-14': '[]',
      'fitme:guest:x': '1',
      aicoach_messages: '[]',
      fitme_saved_plans: '[]',
      unrelated: 'keep',
    });

    clearAccountLocalData(storage, ['u1']);

    assert.deepEqual(storage.keys(), [
      'fitme:guest:x',
      'fitme:u10:nutrition_log_2026-11-14',
      'fitme:u2:nutrition_log_2026-11-14',
      'unrelated',
    ]);
  });

  test('with no known id it still clears the session but no scoped keys', () => {
    const storage = memoryStorage({ fitme_token: 't', 'fitme:u1:a': '1' });
    clearAccountLocalData(storage, []);
    assert.deepEqual(storage.keys(), ['fitme:u1:a']);
  });
});

describe('cachedUserIds', () => {
  test('collects id and _id from the store user and the cached user', () => {
    const storage = memoryStorage({ fitme_user: JSON.stringify({ _id: 'u1', id: 'u1' }) });
    assert.deepEqual(cachedUserIds(storage, { id: 'u1' }), ['u1']);
    assert.deepEqual(cachedUserIds(memoryStorage({ fitme_user: '{bad json' }), { _id: 'u3' }), ['u3']);
    assert.deepEqual(cachedUserIds(memoryStorage(), null), []);
  });
});
