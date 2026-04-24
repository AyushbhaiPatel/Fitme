import axiosClient from '../../../services/api-service/axios-client';
import { aiCoachApiRoutes } from './api-routes';

export const chat = (message, conversationHistory = []) =>
  axiosClient.post(aiCoachApiRoutes.chat, { message, conversationHistory }).then((r) => r.data);

export const getSuggestions = () => axiosClient.get(aiCoachApiRoutes.suggestions).then((r) => r.data);
export const healthCheck = () => axiosClient.get(aiCoachApiRoutes.health).then((r) => r.data);
