import axiosClient from '../../../services/api-service/axios-client';
import { profileApiRoutes } from './api-routes';

export const updateProfile = (profileData) => axiosClient.put(profileApiRoutes.updateProfile, profileData).then((r) => r.data);
export const updateProfilePhoto = (profilePhoto) => axiosClient.put(profileApiRoutes.updateProfilePhoto, { profilePhoto }).then((r) => r.data);
export const deleteProfilePhoto = () => axiosClient.delete(profileApiRoutes.deleteProfilePhoto).then((r) => r.data);
export const getUserStats = () => axiosClient.get(profileApiRoutes.getUserStats).then((r) => r.data);
