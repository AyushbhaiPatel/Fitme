const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const workoutDao = require('./workout.dao');
const service = require('./workout.service');
const { installSessionStore } = require('./workout.testkit');

const makeUser = () => ({
  totalWorkouts: 0,
  totalCaloriesBurned: 0,
  totalWorkoutTimeMinutes: 0,
  averageWorkoutTimeMinutes: 0,
  workoutHistory: [],
});

const useUser = (user = makeUser()) => {
  mock.method(workoutDao, 'findUserById', async () => user);
  const { applyUser: save } = installSessionStore();
  return { user, save };
};

afterEach(() => mock.restoreAll());

describe('invalid workout payloads are rejected with 400, not thrown', () => {
  test('saveWorkoutPlan rejects non-string names and non-object plans', async () => {
    const create = mock.method(workoutDao, 'createPlan', async (p) => p);
    for (const body of [
      { workoutPlan: { goal: 'x' }, name: 42 },
      { workoutPlan: { goal: 'x' }, name: ['a'] },
      { workoutPlan: 'plan', name: 'ok' },
      { workoutPlan: [], name: 'ok' },
      { workoutPlan: { goal: 'x' }, name: '   ' },
    ]) {
      assert.equal((await service.saveWorkoutPlan('u1', body)).code, 400);
    }
    assert.equal(create.mock.callCount(), 0);
  });

  test('createCustomWorkout rejects malformed exercises', async () => {
    const create = mock.method(workoutDao, 'createPlan', async (p) => p);
    for (const body of [
      { name: 7, exercises: [{ name: 'Squat' }] },
      { name: 'Legs', exercises: 'Squat' },
      { name: 'Legs', exercises: [] },
      { name: 'Legs', exercises: [null] },
      { name: 'Legs', exercises: [{ name: 5 }] },
      { name: 'Legs', exercises: ['Squat'] },
    ]) {
      assert.equal((await service.createCustomWorkout('u1', body)).code, 400);
    }
    assert.equal(create.mock.callCount(), 0);
  });

  test('getSavedWorkoutPlans rejects bad paging and never passes NaN to the dao', async () => {
    const list = mock.method(workoutDao, 'getUserPlans', async () => []);
    mock.method(workoutDao, 'countUserPlans', async () => 0);

    assert.equal((await service.getSavedWorkoutPlans('u1', { limit: 'abc' })).code, 400);
    assert.equal((await service.getSavedWorkoutPlans('u1', { page: '-2' })).code, 400);
    assert.equal(list.mock.callCount(), 0);

    const ok = await service.getSavedWorkoutPlans('u1', { limit: '5000', page: '2' });
    assert.equal(ok.code, 200);
    assert.equal(list.mock.calls[0].arguments[1].limit, 100);
    assert.deepEqual(ok.data.pagination, { total: 0, page: 2, limit: 100, totalPages: 0 });

    const defaults = await service.getSavedWorkoutPlans('u1', {});
    assert.equal(defaults.data.pagination.limit, 10);
    assert.equal(defaults.data.pagination.page, 1);
  });

  test('completeWorkout rejects a malformed workout id or exercise list and saves nothing', async () => {
    const { user, save } = useUser();
    const bad = [
      { durationSeconds: 30, caloriesBurned: 10, workoutId: 'not-an-id' },
      { durationSeconds: 30, caloriesBurned: 10, completedExercises: 'Squat' },
      { durationSeconds: 30, caloriesBurned: 10, completedExercises: { name: 'Squat' } },
    ];
    for (const body of bad) assert.equal((await service.completeWorkout('u1', body)).code, 400);
    assert.equal(save.mock.callCount(), 0);
    assert.equal(user.totalWorkouts, 0);
    assert.equal(user.workoutHistory.length, 0);
  });
});

describe('partial workout saves', () => {
  test('a partially finished exercise is stored as not completed, with its set counts', async () => {
    const { user } = useUser();
    const res = await service.completeWorkout('u1', {
      durationSeconds: 47,
      caloriesBurned: 85,
      workoutName: 'Day 1 - Upper',
      completedExercises: [
        { name: 'Bench Press', completed: false, caloriesBurned: 35, completedSets: 2, totalSets: 4 },
        { name: 'Shoulder Press', completed: true, caloriesBurned: 50, completedSets: 3, totalSets: 3 },
        null,
        { name: 'Curl', completed: 'yes', caloriesBurned: -5, completedSets: 1.5 },
      ],
    });

    assert.equal(res.code, 200);
    assert.equal(user.totalWorkouts, 1);
    assert.equal(user.totalCaloriesBurned, 85);
    assert.equal(user.totalWorkoutTimeSeconds, 47);
    assert.deepEqual(user.workoutHistory[0].exercises, [
      { name: 'Bench Press', completed: false, caloriesBurned: 35, completedSets: 2, totalSets: 4 },
      { name: 'Shoulder Press', completed: true, caloriesBurned: 50, completedSets: 3, totalSets: 3 },
      { name: 'Curl', completed: false, caloriesBurned: 0 },
    ]);
  });

  test('a time-only save with no sets counts one workout with 0 calories', async () => {
    const { user } = useUser();
    const res = await service.completeWorkout('u1', { durationSeconds: 20, caloriesBurned: 0, completedExercises: [] });
    assert.equal(res.code, 200);
    assert.equal(user.totalWorkouts, 1);
    assert.equal(user.totalCaloriesBurned, 0);
    assert.equal(user.totalWorkoutTimeSeconds, 20);
    assert.deepEqual(user.workoutHistory[0].exercises, []);
  });
});

describe('account deletion', () => {
  const userDao = require('../user/user.dao');
  const userService = require('../user/user.service');
  const accountDeletion = require('../user/user.deletion');
  const HASH = `$2a$12$${'a'.repeat(53)}`;
  // Keep the other collections' deletes off the unconnected database.
  const stubDependents = () => mock.method(accountDeletion, 'deleteDependentData', async (id) => workoutDao.deleteSessionsForUser(id));

  test('deleting an account also deletes its workout sessions', async () => {
    stubDependents();
    mock.method(userDao, 'findByIdWithPassword', async () => ({ _id: 'u1', password: HASH, comparePassword: async () => true }));
    const delUser = mock.method(userDao, 'deleteById', async () => ({}));
    const delSessions = mock.method(workoutDao, 'deleteSessionsForUser', async () => 3);

    const res = await userService.deleteAccount('u1', 'pw');
    assert.equal(res.code, 200);
    assert.equal(delUser.mock.callCount(), 1);
    assert.deepEqual(delSessions.mock.calls[0].arguments, ['u1']);
  });

  test('a wrong password deletes nothing', async () => {
    stubDependents();
    mock.method(userDao, 'findByIdWithPassword', async () => ({ _id: 'u1', password: HASH, comparePassword: async () => false }));
    const delUser = mock.method(userDao, 'deleteById', async () => ({}));
    const delSessions = mock.method(workoutDao, 'deleteSessionsForUser', async () => 0);

    assert.equal((await userService.deleteAccount('u1', 'bad')).code, 400);
    assert.equal(delUser.mock.callCount(), 0);
    assert.equal(delSessions.mock.callCount(), 0);
  });
});
