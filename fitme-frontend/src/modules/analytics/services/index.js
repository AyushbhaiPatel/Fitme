import axiosClient from '../../../services/api-service/axios-client';
import { analyticsApiRoutes } from './api-routes';
import { unwrapEnvelope } from '../../../utils/api-envelope';

// Largest number of sessions the backend returns with `include=history`.
const HISTORY_LIMIT = 5000;

// Earliest instant any analytics period can show: Jan 1 of this year (month/quarter/year views) or the
// Monday of this week when that falls in the previous year (week view), in the browser's local time.
export const analyticsHistoryStart = (now = new Date()) => {
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return monday < yearStart ? monday : yearStart;
};

// `include=history` adds the workout history the charts are built from, limited to the periods they show.
export const getWorkoutStatistics = () =>
  axiosClient
    .get(analyticsApiRoutes.workoutStatistics, {
      params: { include: 'history', from: analyticsHistoryStart().toISOString(), historyLimit: HISTORY_LIMIT },
    })
    .then(unwrapEnvelope);
