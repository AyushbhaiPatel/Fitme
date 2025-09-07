import axiosClient from '../../../services/api-service/axios-client';
import { analyticsApiRoutes } from './api-routes';

export const getWorkoutStatistics = () =>
  axiosClient.get(analyticsApiRoutes.workoutStatistics).then((response) => response.data);
