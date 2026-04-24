import axiosClient from '../../../services/api-service/axios-client';
import { nutritionApiRoutes } from './api-routes';

export const generateMealPlan = (payload) => axiosClient.post(nutritionApiRoutes.generate, payload).then((r) => r.data);
export const getMealPlans = (limit = 10, skip = 0) => axiosClient.get(nutritionApiRoutes.list, { params: { limit, skip } }).then((r) => r.data);
export const getMealPlan = (planId) => axiosClient.get(nutritionApiRoutes.byId(planId)).then((r) => r.data);
export const deleteMealPlan = (planId) => axiosClient.delete(nutritionApiRoutes.byId(planId)).then((r) => r.data);
export const regenerateMealPlan = (planId) => axiosClient.post(nutritionApiRoutes.regenerate(planId)).then((r) => r.data);
