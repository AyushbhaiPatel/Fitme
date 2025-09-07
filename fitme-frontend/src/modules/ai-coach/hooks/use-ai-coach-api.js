import { useCallback, useMemo } from 'react';
import { chat, getSuggestions, healthCheck } from '../services';

const useAiCoachApi = () => {
  const chatMessage = useCallback((message, conversationHistory = []) => chat(message, conversationHistory), []);
  const fetchSuggestions = useCallback(() => getSuggestions(), []);
  const checkHealth = useCallback(() => healthCheck(), []);

  return useMemo(() => ({
    chat: chatMessage,
    getSuggestions: fetchSuggestions,
    healthCheck: checkHealth,
  }), [chatMessage, fetchSuggestions, checkHealth]);
};

export default useAiCoachApi;
