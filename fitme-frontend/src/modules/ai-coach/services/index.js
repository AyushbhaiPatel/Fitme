import axiosClient from '../../../services/api-service/axios-client';
import { unwrapEnvelope } from '../../../utils/api-envelope';
import { aiCoachApiRoutes } from './api-routes';

export const chat = (message, conversationHistory = []) =>
  axiosClient.post(aiCoachApiRoutes.chat, { message, conversationHistory }).then(unwrapEnvelope);

export const getSuggestions = () => axiosClient.get(aiCoachApiRoutes.suggestions).then(unwrapEnvelope);
export const healthCheck = () => axiosClient.get(aiCoachApiRoutes.health).then((r) => r.data);
