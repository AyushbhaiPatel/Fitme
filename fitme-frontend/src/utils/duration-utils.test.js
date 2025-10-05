import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatClock, clockFormatLabel, secondsFrom } from './duration-utils.js';

test('formatDuration follows the display standard', () => {
  const cases = [
    [0, '0 sec'], [35, '35 sec'], [59, '59 sec'], [60, '1 min'], [90, '1 min 30 sec'], [300, '5 min'],
    [2100, '35 min'], [3600, '1 hr'], [4500, '1 hr 15 min'], [3635, '1 hr'], [7325, '2 hr 2 min'],
  ];
  for (const [seconds, expected] of cases) assert.equal(formatDuration(seconds), expected, `${seconds}s`);
});

test('formatDuration never rounds a sub-minute session up to a minute', () => {
  assert.equal(formatDuration(35), '35 sec');
  assert.equal(formatDuration(59.9), '59 sec');
});

test('formatDuration treats invalid input as zero', () => {
  for (const bad of [undefined, null, NaN, -5, 'abc', Infinity]) assert.equal(formatDuration(bad), '0 sec');
});

test('formatClock renders mm:ss and h:mm:ss with a matching label', () => {
  assert.equal(formatClock(35), '00:35');
  assert.equal(formatClock(90), '01:30');
  assert.equal(formatClock(2100), '35:00');
  assert.equal(formatClock(4500), '1:15:00');
  assert.equal(clockFormatLabel(35), 'mm:ss');
  assert.equal(clockFormatLabel(4500), 'h:mm:ss');
});

test('secondsFrom prefers seconds and falls back to legacy minutes', () => {
  assert.equal(secondsFrom(35, 0.58), 35);
  assert.equal(secondsFrom(undefined, 1), 60);
  assert.equal(secondsFrom(null, 35), 2100);
  assert.equal(secondsFrom(undefined, undefined), 0);
});
