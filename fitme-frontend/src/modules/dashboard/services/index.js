import axiosClient from '../../../services/api-service/axios-client';
import { dashboardApiRoutes } from './api-routes';

export const getUserStats = () => axiosClient.get(dashboardApiRoutes.userStats).then((r) => r.data);
export const getWorkoutStatistics = () => axiosClient.get(dashboardApiRoutes.workoutStatistics).then((r) => r.data);
export const getWeeklySummary = () => axiosClient.get(dashboardApiRoutes.weeklySummary).then((r) => r.data);
