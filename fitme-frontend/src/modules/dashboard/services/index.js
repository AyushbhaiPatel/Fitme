import axiosClient from '../../../services/api-service/axios-client';
import { dashboardApiRoutes } from './api-routes';
import { unwrapEnvelope } from '../../../utils/api-envelope';

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

export const getWorkoutStatistics = () => axiosClient.get(dashboardApiRoutes.workoutStatistics).then(unwrapEnvelope);
// The server buckets days/weeks in this time zone so "today" and "this week" match the user's calendar.
export const getWeeklySummary = () =>
  axiosClient.get(dashboardApiRoutes.weeklySummary, { params: { tz: browserTimeZone() } }).then(unwrapEnvelope);
