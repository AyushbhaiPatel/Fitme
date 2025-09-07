import { useState, useCallback } from 'react';

export const useToast = () => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'error', duration = 5000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, duration, isVisible: true }]);
    if (duration > 0) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    }
    return id;
  }, []);

  const hideToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showError = useCallback((message, duration) => showToast(message, 'error', duration), [showToast]);
  const showSuccess = useCallback((message, duration) => showToast(message, 'success', duration), [showToast]);
  const clearAll = useCallback(() => setToasts([]), []);

  return { toasts, showToast, hideToast, showError, showSuccess, clearAll };
};
