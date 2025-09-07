// Single shared axios instance for the entire app

import axios from 'axios';
import { ENV } from '../../constants/environment';

const axiosClient = axios.create({
  baseURL: ENV.API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Token helpers
export const getToken = () => localStorage.getItem('fitme_token');

export const setToken = (token) => {
  if (token) {
    localStorage.setItem('fitme_token', token);
    axiosClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
};

export const removeToken = () => {
  localStorage.removeItem('fitme_token');
  delete axiosClient.defaults.headers.common['Authorization'];
};

// Restore token on load
const existingToken = getToken();
if (existingToken) {
  axiosClient.defaults.headers.common['Authorization'] = `Bearer ${existingToken}`;
}

// Request interceptor
axiosClient.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - refresh on 401
axiosClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('fitme_refresh_token');
        if (refreshToken) {
          const response = await axiosClient.post('/auth/refresh', { refreshToken });
          const { accessToken, refreshToken: newRefreshToken } = response.data.data.tokens;
          setToken(accessToken);
          localStorage.setItem('fitme_refresh_token', newRefreshToken);
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return axiosClient(originalRequest);
        }
      } catch (refreshError) {
        removeToken();
        localStorage.removeItem('fitme_refresh_token');
        localStorage.removeItem('fitme_user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

// Error handler utility
export const handleApiError = (error) => {
  if (error.response) {
    const { status, data } = error.response;
    if (data.errorCode) {
      return {
        message: data.message,
        errorCode: data.errorCode,
        suggestions: data.suggestions || [],
        field: data.field,
        errors: data.errors || [],
        missingFields: data.missingFields,
        attemptsRemaining: data.attemptsRemaining,
        timeRemaining: data.timeRemaining,
      };
    }
    const messages = {
      400: { message: data.message || 'Invalid request.', errorCode: 'BAD_REQUEST' },
      401: { message: data.message || 'Authentication failed.', errorCode: 'UNAUTHORIZED' },
      403: { message: 'Access denied.', errorCode: 'FORBIDDEN' },
      404: { message: 'Resource not found.', errorCode: 'NOT_FOUND' },
      429: { message: data.message || 'Too many requests.', errorCode: 'RATE_LIMITED' },
      500: { message: 'Server error.', errorCode: 'SERVER_ERROR' },
    };
    return messages[status] || { message: data.message || 'Unexpected error', errorCode: 'UNKNOWN_ERROR' };
  }
  if (error.request) return { message: 'Network error.', errorCode: 'NETWORK_ERROR' };
  return { message: error.message || 'Unexpected error', errorCode: 'UNKNOWN_ERROR' };
};

export default axiosClient;
