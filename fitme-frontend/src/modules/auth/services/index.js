import axiosClient from '../../../services/api-service/axios-client';
import { authApiRoutes } from './api-routes';

export const verifyOTP = async (email, otp) => {
  const response = await axiosClient.post(authApiRoutes.verifyOtp, { email, otp });
  return response.data;
};

export const resendOTP = async (email) => {
  const response = await axiosClient.post(authApiRoutes.resendOtp, { email });
  return response.data;
};

export const requestPasswordReset = async (email) => {
  const response = await axiosClient.post(authApiRoutes.forgotPasswordRequest, { email });
  return response.data;
};

export const resetPasswordWithOTP = async ({ email, otp, newPassword, confirmPassword }) => {
  const response = await axiosClient.post(authApiRoutes.forgotPasswordConfirm, {
    email, otp, password: newPassword, confirmPassword,
  });
  return response.data;
};
