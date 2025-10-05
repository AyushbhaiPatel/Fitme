const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const gemini = require('../../config/gemini');
const workoutDao = require('./workout.dao');
const service = require('./workout.service');

const { buildPrompt, parseWorkoutResponse, normalizeCustomOptions, getDefaultFocusArea, parseSessionMinutes } = service._internal;

const userData = {
  goal: 'muscle-gain',
  fitnessExperience: 'beginner',
  preferredWorkouts: [],
  workoutFrequency: '2-3',
  workoutDuration: '30-45',
};

const validPlan = {
  name: 'Plan',
  goal: 'Muscle Building',
  days: [{ day: 'Day 1', workout_type: 'Push', estimated_calories_burned: 300, exercises: [{ name: 'Bench Press', type: 'Strength', sets: 3, reps: 10 }] }],
};

describe('buildPrompt', () => {
  // Regression: "Cannot read properties of null (reading 'focusArea')"
  for (const [label, value] of [['null', null], ['undefined', undefined], ['empty object', {}], ['null focusArea', { focusArea: null }], ['a string', 'legs'], ['an array', []]]) {
    test(`does not throw when customOptions is ${label} and falls back to a goal-based focus`, () => {
      const prompt = buildPrompt(userData, 3, 45, value);
      assert.match(prompt, new RegExp(`- Focus Area: ${getDefaultFocusArea('muscle-gain')}`));
      assert.doesNotMatch(prompt, /\b(null|undefined)\b(?! for reps)/);
    });
  }

  test('uses the provided focus area and other advanced options', () => {
    const prompt = buildPrompt(userData, 3, 45, { focusArea: ' legs ', intensity: 'high', equipment: 'full-gym', specificGoals: 'no jumping' });
    assert.match(prompt, /- Focus Area: legs\n- Intensity: high\n- Equipment: full-gym\n- Special Instructions: no jumping/);
  });

  test('unknown goal falls back to the general-fitness focus', () => {
    assert.equal(getDefaultFocusArea('something-else'), getDefaultFocusArea('general-fitness'));
    assert.match(buildPrompt({ ...userData, goal: undefined }, 3, 45, null), /- Primary Goal: General Fitness/);
  });
});

describe('normalizeCustomOptions / parseSessionMinutes', () => {
  test('always returns string fields', () => {
    assert.deepEqual(normalizeCustomOptions(null), { focusArea: '', intensity: '', equipment: '', specificGoals: '', duration: '' });
    assert.equal(normalizeCustomOptions({ focusArea: 42 }).focusArea, '42');
  });

  test('parses duration ranges', () => {
    assert.equal(parseSessionMinutes('30-45'), 45);
    assert.equal(parseSessionMinutes('90+'), 90);
    assert.equal(parseSessionMinutes(60), 60);
    assert.equal(parseSessionMinutes(null), 45);
  });
});

describe('parseWorkoutResponse', () => {
  test('parses fenced JSON and normalises exercises', () => {
    const plan = parseWorkoutResponse('```json\n' + JSON.stringify(validPlan) + '\n```');
    assert.equal(plan.days.length, 1);
    assert.equal(plan.days[0].exercises[0].rest_between_sets_seconds, 60);
  });

  test('coerces rep ranges and non-numeric reps', () => {
    const text = '{"days":[{"exercises":[{"name":"A","reps":"8-12"},{"name":"B","reps":"AMRAP"},{"name":"C","reps":"AMRAP-max"}]}]}';
    assert.deepEqual(parseWorkoutResponse(text).days[0].exercises.map((e) => e.reps), [10, null, null]);
  });

  test('drops null days and null exercises instead of crashing', () => {
    const text = JSON.stringify({ days: [null, { day: 'Day 1', exercises: [null, { name: 'Squat' }] }] });
    const plan = parseWorkoutResponse(text);
    assert.equal(plan.days.length, 1);
    assert.equal(plan.days[0].exercises.length, 1);
  });

  for (const [label, text] of [['null text', null], ['empty text', ''], ['literal null', 'null'], ['days: null', '{"days":null}'], ['days: []', '{"days":[]}'], ['days: [null]', '{"days":[null]}'], ['exercises not an array', '{"days":[{"exercises":{}}]}']]) {
    test(`rejects ${label} with a clear error, not a TypeError`, () => {
      assert.throws(() => parseWorkoutResponse(text), (err) => !(err instanceof TypeError));
    });
  }
});

describe('generateWorkoutPlan', () => {
  let generate;
  const stubUser = (user) => mock.method(workoutDao, 'findUserById', async () => user);

  beforeEach(() => {
    mock.method(gemini, 'isAvailable', () => true);
    generate = mock.method(gemini, 'generateContent', async () => JSON.stringify(validPlan));
    mock.method(console, 'error', () => {});
  });
  afterEach(() => mock.restoreAll());

  for (const [label, body] of [['customOptions null', { customOptions: null }], ['customOptions missing', {}], ['no body', undefined], ['focusArea null', { customOptions: { focusArea: null } }]]) {
    test(`calls Gemini and returns the real plan with ${label}`, async () => {
      stubUser({ fitnessGoals: ['weight-loss'], preferredWorkouts: '' });
      const res = await service.generateWorkoutPlan('u1', body);
      assert.equal(res.code, 200);
      assert.equal(res.data.isAIGenerated, true);
      assert.equal(res.data.isDemoMode, false);
      assert.equal(res.data.workoutPlan.days[0].exercises[0].name, 'Bench Press');
      assert.equal(generate.mock.callCount(), 1);
      assert.match(generate.mock.calls[0].arguments[0], new RegExp(`- Focus Area: ${getDefaultFocusArea('weight-loss')}`));
    });
  }

  test('passes a populated focusArea and duration override to Gemini', async () => {
    stubUser({ fitnessGoals: ['strength'], preferredWorkouts: 'weights, cardio', workoutDuration: '30-45' });
    await service.generateWorkoutPlan('u1', { workoutDuration: '30-45', customOptions: { focusArea: 'upper body', duration: '60-90' } });
    const prompt = generate.mock.calls[0].arguments[0];
    assert.match(prompt, /- Focus Area: upper body/);
    assert.match(prompt, /- Session Duration: 90 minutes/);
    assert.match(prompt, /- Preferred Workouts: weights, cardio/);
  });

  test('works for a user with no saved preferences or profile data', async () => {
    stubUser({});
    const res = await service.generateWorkoutPlan('u1', { customOptions: null });
    assert.equal(res.success, true);
    assert.match(generate.mock.calls[0].arguments[0], /- Primary Goal: General Fitness/);
  });

  for (const [label, impl] of [['Gemini throws', async () => { throw new Error('quota'); }], ['Gemini returns garbage', async () => 'sorry, no plan'], ['Gemini returns null days', async () => '{"days":[null]}']]) {
    test(`reports failure (no demo plan) when ${label}`, async () => {
      stubUser({});
      mock.method(gemini, 'generateContent', impl);
      const res = await service.generateWorkoutPlan('u1', {});
      assert.equal(res.success, false);
      assert.equal(res.code, 502);
      assert.equal(res.data, undefined);
    });
  }

  test('reports failure when Gemini is not configured', async () => {
    stubUser({});
    mock.method(gemini, 'isAvailable', () => false);
    const res = await service.generateWorkoutPlan('u1', {});
    assert.equal(res.success, false);
    assert.equal(res.code, 503);
    assert.equal(generate.mock.callCount(), 0);
  });

  test('returns 404 for an unknown user', async () => {
    stubUser(null);
    assert.equal((await service.generateWorkoutPlan('u1', {})).code, 404);
  });
});
