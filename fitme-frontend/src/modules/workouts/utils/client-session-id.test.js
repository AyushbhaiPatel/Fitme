import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_SESSION_ID_PATTERN,
  isValidClientSessionId,
  generateClientSessionId,
  ensureClientSessionId,
} from './client-session-id.js';

test('uses crypto.randomUUID when available', () => {
  const id = generateClientSessionId({ cryptoImpl: { randomUUID: () => '123e4567-e89b-12d3-a456-426614174000' } });
  assert.equal(id, '123e4567-e89b-12d3-a456-426614174000');
  assert.ok(isValidClientSessionId(id));
});

test('real crypto produces valid, distinct ids', () => {
  const a = generateClientSessionId();
  const b = generateClientSessionId();
  assert.match(a, CLIENT_SESSION_ID_PATTERN);
  assert.match(b, CLIENT_SESSION_ID_PATTERN);
  assert.notEqual(a, b);
});

test('fallback without randomUUID uses getRandomValues and stays within [A-Za-z0-9_-]{8,64}', () => {
  const id = generateClientSessionId({
    cryptoImpl: { getRandomValues: (arr) => arr.map((_, i) => i * 13) },
    now: () => 1_700_000_000_000,
  });
  assert.match(id, CLIENT_SESSION_ID_PATTERN);
  assert.ok(id.startsWith('ws_'));
});

test('fallback with no crypto at all uses Math.random-style source', () => {
  let n = 0;
  const id = generateClientSessionId({ cryptoImpl: undefined, random: () => ((n += 0.37) % 1), now: () => 42 });
  assert.match(id, CLIENT_SESSION_ID_PATTERN);
  assert.ok(id.length >= 8 && id.length <= 64);
});

test('fallback when randomUUID throws or returns garbage', () => {
  const throwing = generateClientSessionId({ cryptoImpl: { randomUUID: () => { throw new Error('insecure'); } } });
  assert.match(throwing, CLIENT_SESSION_ID_PATTERN);
  const garbage = generateClientSessionId({ cryptoImpl: { randomUUID: () => 'not valid!' } });
  assert.match(garbage, CLIENT_SESSION_ID_PATTERN);
});

test('isValidClientSessionId enforces the backend contract', () => {
  assert.equal(isValidClientSessionId('abcd_123'), true);
  assert.equal(isValidClientSessionId('a'.repeat(64)), true);
  assert.equal(isValidClientSessionId('a'.repeat(65)), false);
  assert.equal(isValidClientSessionId('short'), false);
  assert.equal(isValidClientSessionId('has space1'), false);
  assert.equal(isValidClientSessionId(null), false);
  assert.equal(isValidClientSessionId(12345678), false);
});

test('ensureClientSessionId reuses an existing valid id and replaces an invalid one', () => {
  assert.equal(ensureClientSessionId('keep-this-id-1'), 'keep-this-id-1');
  const fresh = ensureClientSessionId('bad id');
  assert.match(fresh, CLIENT_SESSION_ID_PATTERN);
  assert.notEqual(fresh, 'bad id');
});
