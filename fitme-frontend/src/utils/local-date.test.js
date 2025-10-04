import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toLocalDateKey, parseLocalDateKey, isLocalDateKey, legacyUtcDateKey } from './local-date.js';

// Instants are built with local constructors so the expectations hold in every TZ the suite runs under.

describe('toLocalDateKey', () => {
  test('uses the local calendar day just after and just before midnight', () => {
    assert.equal(toLocalDateKey(new Date(2026, 10, 15, 0, 5)), '2026-11-15');
    assert.equal(toLocalDateKey(new Date(2026, 10, 14, 23, 55)), '2026-11-14');
  });

  test('month and year boundaries', () => {
    assert.equal(toLocalDateKey(new Date(2026, 9, 31, 23, 59)), '2026-10-31');
    assert.equal(toLocalDateKey(new Date(2026, 10, 1, 0, 1)), '2026-11-01');
    assert.equal(toLocalDateKey(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
    assert.equal(toLocalDateKey(new Date(2027, 0, 1, 0, 0, 1)), '2027-01-01');
  });

  test('accepts timestamps and rejects invalid dates', () => {
    const d = new Date(2026, 1, 3, 12);
    assert.equal(toLocalDateKey(d.toISOString()), '2026-02-03');
    assert.equal(toLocalDateKey(d.getTime()), '2026-02-03');
    assert.equal(toLocalDateKey(new Date('nope')), null);
  });

  test('differs from the UTC key whenever local and UTC days differ', () => {
    const lateEvening = new Date(2026, 10, 14, 23, 0);
    const earlyMorning = new Date(2026, 10, 15, 1, 0);
    for (const d of [lateEvening, earlyMorning]) {
      const utcDay = d.getUTCDate();
      const sameDay = utcDay === d.getDate();
      assert.equal(toLocalDateKey(d) === legacyUtcDateKey(d), sameDay);
    }
  });
});

describe('parseLocalDateKey', () => {
  test('returns local midnight of the named day', () => {
    const d = parseLocalDateKey('2027-01-01');
    assert.equal(d.getFullYear(), 2027);
    assert.equal(d.getMonth(), 0);
    assert.equal(d.getDate(), 1);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });

  test('round-trips every day of a leap year, DST changes included', () => {
    for (let d = new Date(2024, 0, 1); d.getFullYear() === 2024; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const key = toLocalDateKey(d);
      assert.equal(parseLocalDateKey(key).getTime(), d.getTime(), key);
      assert.equal(toLocalDateKey(parseLocalDateKey(key)), key);
    }
  });

  test('rejects malformed and impossible keys', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '2026-11-14T00:00:00Z', '', null, undefined, 20261114]) {
      assert.equal(parseLocalDateKey(bad), null, String(bad));
      assert.equal(isLocalDateKey(bad), false);
    }
    assert.equal(isLocalDateKey('2024-02-29'), true);
  });
});

test('legacyUtcDateKey reproduces the old toISOString key', () => {
  const d = new Date(2026, 10, 15, 0, 30);
  assert.equal(legacyUtcDateKey(d), d.toISOString().slice(0, 10));
});
