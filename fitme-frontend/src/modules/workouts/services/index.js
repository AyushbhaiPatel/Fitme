import axiosClient from '../../../services/api-service/axios-client';
import { workoutApiRoutes } from './api-routes';

export const generateWorkoutPlan = (profile = {}) => axiosClient.post(workoutApiRoutes.generate, profile).then((r) => r.data);
export const saveWorkoutPlan = (workoutPlan, name) => axiosClient.post(workoutApiRoutes.save, { workoutPlan, name }).then((r) => r.data);
export const getSavedWorkoutPlans = (options = {}) => {
  const { page = 1, limit = 10, sort = 'createdAt' } = options;
  return axiosClient.get(workoutApiRoutes.saved, { params: { page, limit, sort } }).then((r) => r.data);
};
export const getWorkoutPlanById = (planId) => axiosClient.get(workoutApiRoutes.byId(planId)).then((r) => r.data);
export const deleteWorkoutPlan = (planId) => axiosClient.delete(workoutApiRoutes.byId(planId)).then((r) => r.data);
export const setActivePlan = (planId) => axiosClient.put(workoutApiRoutes.activate(planId)).then((r) => r.data);
export const createCustomWorkout = (name, exercises) => axiosClient.post(workoutApiRoutes.custom, { name, exercises }).then((r) => r.data);
export const completeWorkout = (workoutData) => axiosClient.post(workoutApiRoutes.complete, workoutData).then((r) => r.data);
export const getWorkoutStatistics = () => axiosClient.get(workoutApiRoutes.statistics).then((r) => r.data);
export const getWeeklySummary = () => axiosClient.get(workoutApiRoutes.weeklySummary).then((r) => r.data);
