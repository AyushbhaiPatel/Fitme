import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const USER = { id: 'u1', _id: 'u1', firstName: 'Sam' };

const PLAN = {
  _id: 'plan-1',
  goal: 'Strength',
  duration_per_day_minutes: 30,
  preference: ['Strength'],
  days: [
    {
      day: 'Day 1',
      workout_type: 'Upper Body',
      estimated_calories_burned: 115,
      exercises: [
        { name: 'Push-ups', type: 'Strength', sets: 3, reps: 10, calories_burned: 45 },
        { name: 'Rows', type: 'Strength', sets: 2, reps: 10, calories_burned: 70, rest_between_sets_seconds: 60 },
      ],
    },
    {
      day: 'Day 2',
      workout_type: 'Lower Body',
      estimated_calories_burned: 90,
      exercises: [{ name: 'Squats', type: 'Strength', sets: 4, reps: 12, calories_burned: 90 }],
    },
  ],
};

const api = vi.hoisted(() => ({ completeWorkout: null }));

vi.mock('../../../context/auth-context', () => ({ useAuth: () => ({ user: USER }) }));
vi.mock('../../../store/auth-store', () => ({ useAuthStore: () => ({ getCurrentUser: () => Promise.resolve() }) }));
vi.mock('./workout-plan-generator', () => ({
  default: ({ onPlanGenerated }) => (
    <button onClick={() => onPlanGenerated({ workoutPlan: PLAN, isDemoMode: false })}>Mock Generate</button>
  ),
}));
vi.mock('../services', () => ({
  generateWorkoutPlan: vi.fn(),
  saveWorkoutPlan: vi.fn(),
  getSavedWorkoutPlans: vi.fn(() => Promise.resolve({ workoutPlans: [] })),
  getWorkoutPlanById: vi.fn(),
  deleteWorkoutPlan: vi.fn(),
  createCustomWorkout: vi.fn(),
  completeWorkout: (...args) => api.completeWorkout(...args),
}));

const { default: Workouts } = await import('./workouts');

const heading = () => screen.getByRole('heading', { level: 3, name: /^Day \d$/ });
const dayButton = (name) => screen.getByRole('button', { name });

const renderWithPlan = () => {
  render(<Workouts />);
  fireEvent.click(screen.getByText('Mock Generate'));
};

beforeEach(() => {
  sessionStorage.clear();
  api.completeWorkout = vi.fn(() => Promise.resolve({ message: 'ok' }));
});

describe('Workouts active-session guards', () => {
  test('without a session, day buttons switch days and no warning appears', () => {
    renderWithPlan();
    expect(heading()).toHaveTextContent('Day 1');
    fireEvent.click(dayButton('Day 2'));
    expect(heading()).toHaveTextContent('Day 2');
    expect(screen.queryByText(/A workout is in progress/)).not.toBeInTheDocument();
  });

  test('during a session another day is blocked with a warning; continue dismisses, end opens the end dialog', () => {
    renderWithPlan();
    fireEvent.click(screen.getByText('Start Workout'));
    fireEvent.click(screen.getAllByText('Complete Set 1')[0]);

    fireEvent.click(dayButton('Day 2'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('A workout is in progress for Day 1.');
    expect(alert).toHaveTextContent('Finish or end it before switching days.');
    expect(heading()).toHaveTextContent('Day 1');
    expect(screen.queryByText('Squats')).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByText('Continue Current Workout'));
    expect(screen.queryByText(/A workout is in progress/)).not.toBeInTheDocument();
    expect(screen.getByText('Set 2/3')).toBeInTheDocument(); // progress kept

    // Clicking the active day is a no-op.
    fireEvent.click(dayButton('Day 1'));
    expect(screen.queryByText(/A workout is in progress/)).not.toBeInTheDocument();

    fireEvent.click(dayButton('Day 2'));
    fireEvent.click(screen.getByText('End Current Workout'));
    expect(screen.getByText('End workout early?')).toBeInTheDocument();
  });

  test('Generate New Plan is blocked during a session', () => {
    renderWithPlan();
    fireEvent.click(screen.getByText('Start Workout'));
    fireEvent.click(screen.getByText('Generate New Plan'));
    expect(screen.getByRole('alert')).toHaveTextContent('Finish or end it before generating a new plan.');
    expect(heading()).toHaveTextContent('Day 1');
  });

  test('save sends the session clientSessionId; a network failure retry reuses it; duplicate counts as success', async () => {
    api.completeWorkout = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
      .mockResolvedValueOnce({ duplicate: true, message: 'Already recorded' });

    renderWithPlan();
    fireEvent.click(screen.getByText('Start Workout'));
    fireEvent.click(screen.getByText('End Workout'));
    fireEvent.click(screen.getByText('Save Progress'));
    expect(await screen.findByText('Failed to save progress. Please try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save Progress'));
    await waitFor(() => expect(screen.queryByText('End workout early?')).not.toBeInTheDocument());
    expect(screen.getByText(/Progress saved/)).toBeInTheDocument();

    expect(api.completeWorkout).toHaveBeenCalledTimes(2);
    const [first] = api.completeWorkout.mock.calls[0];
    const [second] = api.completeWorkout.mock.calls[1];
    expect(first.clientSessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(second).toEqual(first);
    expect(first.workoutName).toBe('Day 1 - Upper Body');
    expect(sessionStorage.getItem('fitme:u1:active_workout_session')).toBeNull();
  });

  test('409 conflict shows the server message and keeps the session', async () => {
    api.completeWorkout = vi.fn().mockRejectedValueOnce({ response: { status: 409, data: { message: 'Session already saved with different data' } } });
    renderWithPlan();
    fireEvent.click(screen.getByText('Start Workout'));
    fireEvent.click(screen.getByText('End Workout'));
    fireEvent.click(screen.getByText('Save Progress'));
    expect(await screen.findByText('Session already saved with different data')).toBeInTheDocument();
    expect(screen.getByText('End workout early?')).toBeInTheDocument();
  });

  test('an active session is persisted and offered for resume after remount', () => {
    const { unmount } = render(<Workouts />);
    fireEvent.click(screen.getByText('Mock Generate'));
    fireEvent.click(dayButton('Day 2'));
    fireEvent.click(screen.getByText('Start Workout'));
    fireEvent.click(screen.getByText('Complete Set 1'));
    const stored = JSON.parse(sessionStorage.getItem('fitme:u1:active_workout_session'));
    unmount();

    render(<Workouts />);
    expect(screen.getByText('Resume your workout?')).toBeInTheDocument();
    expect(screen.getByText(/unfinished workout for Day 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Resume Workout'));
    expect(heading()).toHaveTextContent('Day 2');
    expect(screen.getByText('Set 2/4')).toBeInTheDocument();
    expect(screen.getByText('End Workout')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('fitme:u1:active_workout_session')).session.clientSessionId)
      .toBe(stored.session.clientSessionId);
  });

  test('discard then a new session starts with no stale set counts or rest timer', () => {
    renderWithPlan();
    fireEvent.click(screen.getByText('Start Workout'));
    fireEvent.click(screen.getAllByText('Complete Set 1')[1]); // Rows: starts the 60s rest timer
    expect(screen.getByText(/Rest Time:/)).toBeInTheDocument();
    expect(screen.getByText('Set 2/2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('End Workout'));
    fireEvent.click(screen.getByText('Discard Workout'));
    fireEvent.click(screen.getByText('Start Workout'));
    expect(screen.queryByText(/Rest Time:/)).not.toBeInTheDocument();
    expect(screen.getByText('Set 1/2')).toBeInTheDocument();
    expect(screen.getByText('Set 1/3')).toBeInTheDocument();
  });

  test('discarding the stored session clears it', () => {
    const { unmount } = render(<Workouts />);
    fireEvent.click(screen.getByText('Mock Generate'));
    fireEvent.click(screen.getByText('Start Workout'));
    unmount();

    render(<Workouts />);
    fireEvent.click(screen.getByText('Discard Workout'));
    expect(screen.queryByText('Resume your workout?')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('fitme:u1:active_workout_session')).toBeNull();
  });
});
