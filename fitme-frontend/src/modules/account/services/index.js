import axiosClient from '../../../services/api-service/axios-client';
import { settingsApiRoutes } from './api-routes';

export const deleteAccount = (password) =>
  axiosClient.delete(settingsApiRoutes.deleteAccount, { data: { password } }).then((r) => r.data);
