// Pure rules for an active workout session: day lock, plan-change guards, which day/payload is saved,
// and how a POST /workouts/complete result or failure is interpreted.
import { generateClientSessionId, isValidClientSessionId } from './client-session-id.js';
import { buildSessionSummary, buildCompletionPayload } from './workout-session-utils.js';

/**
 * Session object kept in page state. The session day's data and the plan id are snapshotted at start, so
 * the saved payload always describes the day that was trained, whatever the page displays later.
 */
export const createWorkoutSession = ({ workoutPlan, dayIndex, now = Date.now(), clientSessionId } = {}) => {
  const dayData = workoutPlan?.days?.[dayIndex] || null;
  return {
    clientSessionId: isValidClientSessionId(clientSessionId) ? clientSessionId : generateClientSessionId(),
    dayIndex,
    dayName: dayData?.day || `Day ${Number(dayIndex) + 1}`,
    dayData,
    planId: workoutPlan?._id || null,
    startTime: now,
    totalExercises: dayData?.exercises?.length || 0,
  };
};

/** Day whose exercises are shown: the session day while a session exists, otherwise the selected day. */
export const getDisplayedDayIndex = ({ session, selectedDay }) => (session ? session.dayIndex : selectedDay);

/** Day data the session is saved against (the start-time snapshot, falling back to the plan). */
export const getSessionDayData = ({ session, workoutPlan }) => {
  if (!session) return null;
  return session.dayData || workoutPlan?.days?.[session.dayIndex] || null;
};

/**
 * POST /workouts/complete body for a session: always the session's day, plan id and idempotency key,
 * never whatever day or plan the page happens to display.
 */
export const buildSessionCompletionPayload = ({ session, workoutPlan, completedExercises, setsDone, durationSeconds }) => {
  const dayData = getSessionDayData({ session, workoutPlan });
  const summary = buildSessionSummary({ exercises: dayData?.exercises, completedExercises, setsDone });
  return {
    summary,
    payload: buildCompletionPayload({
      clientSessionId: session?.clientSessionId,
      workoutId: session?.planId ?? null,
      dayData,
      summary,
      durationSeconds,
    }),
  };
};

/**
 * Decision for a click on a day button.
 * - 'select'  no session: switch days
 * - 'noop'    session active and the session day was clicked
 * - 'blocked' session active and another day was clicked: show the in-progress warning
 */
export const resolveDaySelection = ({ session, selectedDay, requestedDay }) => {
  if (!session) return requestedDay === selectedDay ? 'noop' : 'select';
  return requestedDay === session.dayIndex ? 'noop' : 'blocked';
};

/** Any action that replaces or removes the displayed plan is blocked while a session exists. */
export const resolvePlanChange = ({ session }) => (session ? 'blocked' : 'allow');

/** Deleting a saved plan is only blocked when it is the plan the active session belongs to. */
export const isPlanDeleteBlocked = ({ session, workoutPlan, planId }) => {
  if (!session || !planId) return false;
  return planId === session.planId || planId === workoutPlan?._id;
};

/** Second line of the in-progress warning, per attempted action. */
export const GUARD_REASONS = {
  day: 'Finish or end it before switching days.',
  generate: 'Finish or end it before generating a new plan.',
  load: 'Finish or end it before loading another plan.',
  custom: 'Finish or end it before creating a custom workout.',
  delete: 'Finish or end it before deleting this plan.',
};

export const sessionInProgressMessage = (dayName) => `A workout is in progress for ${dayName || 'this day'}.`;

// Payload fields other than duration that describe the work done.
const progressSignature = (payload) => JSON.stringify({
  clientSessionId: payload?.clientSessionId,
  workoutId: payload?.workoutId,
  workoutName: payload?.workoutName,
  caloriesBurned: payload?.caloriesBurned,
  completedExercises: payload?.completedExercises,
});

/**
 * Payload to send. After a save whose outcome is unknown (network error/timeout/5xx) the exact same body is
 * resent as long as no further progress was made, so the server can deduplicate the retry even if the
 * duration was recomputed (e.g. after "Continue Workout" or a resume). New progress sends the new body.
 */
export const selectPayloadForSave = ({ freshPayload, pendingAttempt }) => {
  if (!pendingAttempt || pendingAttempt.clientSessionId !== freshPayload?.clientSessionId) return freshPayload;
  return progressSignature(pendingAttempt) === progressSignature(freshPayload) ? pendingAttempt : freshPayload;
};

/** A repeat of an already-recorded key: HTTP 200 with `data.duplicate: true`. Treated exactly like success. */
export const isDuplicateCompletion = (result) => result?.duplicate === true;

/**
 * Failure of POST /workouts/complete.
 * - 'conflict' (409): same key, different payload. Show the server message, keep the session.
 * - 'unknown'  network error, timeout or 5xx: the server may have stored it; retry with the same key/body.
 * - 'rejected' other 4xx: the request was not stored.
 */
export const classifyCompletionError = (err) => {
  const status = err?.response?.status;
  if (status === 409) {
    const message = err.response?.data?.message;
    return {
      kind: 'conflict',
      message: typeof message === 'string' && message.trim()
        ? message
        : 'This workout session was already saved with different details.',
    };
  }
  if (!status || status >= 500) return { kind: 'unknown' };
  return { kind: 'rejected' };
};
