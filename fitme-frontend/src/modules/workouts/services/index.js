import axiosClient from '../../../services/api-service/axios-client';
import { workoutApiRoutes } from './api-routes';
import { unwrapEnvelope as unwrap } from '../../../utils/api-envelope';

export const generateWorkoutPlan = (profile = {}) => axiosClient.post(workoutApiRoutes.generate, profile).then(unwrap);
export const saveWorkoutPlan = (workoutPlan, name) => axiosClient.post(workoutApiRoutes.save, { workoutPlan, name }).then(unwrap);
export const getSavedWorkoutPlans = (options = {}) => {
  const { page = 1, limit = 10, sort = 'createdAt' } = options;
  return axiosClient.get(workoutApiRoutes.saved, { params: { page, limit, sort } }).then(unwrap);
};
export const getWorkoutPlanById = (planId) => axiosClient.get(workoutApiRoutes.byId(planId)).then(unwrap);
export const deleteWorkoutPlan = (planId) => axiosClient.delete(workoutApiRoutes.byId(planId)).then(unwrap);
export const setActivePlan = (planId) => axiosClient.put(workoutApiRoutes.activate(planId)).then(unwrap);
export const createCustomWorkout = (name, exercises) => axiosClient.post(workoutApiRoutes.custom, { name, exercises }).then(unwrap);
export const completeWorkout = (workoutData) => axiosClient.post(workoutApiRoutes.complete, workoutData).then(unwrap);
export const getWorkoutStatistics = () => axiosClient.get(workoutApiRoutes.statistics).then(unwrap);
export const getWeeklySummary = () => axiosClient.get(workoutApiRoutes.weeklySummary).then(unwrap);
