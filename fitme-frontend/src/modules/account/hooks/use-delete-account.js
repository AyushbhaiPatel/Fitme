import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { removeToken } from '../../../services/api-service/axios-client';
import { useAuthStore } from '../../../store/auth-store';
import { ROUTES } from '../../../routes/local-routes';
import { deleteAccount as deleteAccountRequest } from '../services';
import { cachedUserIds, clearAccountLocalData } from '../services/local-account-data';

export const DELETE_MESSAGES = {
  PASSWORD_REQUIRED: 'Enter your current password to delete your account.',
  INCORRECT_PASSWORD: 'Incorrect password. Please try again.',
  FAILED: "We couldn't delete your account. Please try again.",
  NETWORK: "We couldn't reach the server. Check your connection and try again.",
  DELETED: 'Your account has been deleted.',
};

// Maps an API failure to { field, message }: `field: 'password'` errors render under the password input.
const toDeleteError = (err) => {
  const res = err?.response;
  if (!res) return { field: null, message: DELETE_MESSAGES.NETWORK };
  const { status, data = {} } = res;
  if (data.errorCode === 'INCORRECT_PASSWORD') return { field: 'password', message: DELETE_MESSAGES.INCORRECT_PASSWORD };
  if (status === 400 && (data.errorCode === 'PASSWORD_REQUIRED' || data.errors?.[0]?.field === 'password')) {
    return { field: 'password', message: data.message || DELETE_MESSAGES.PASSWORD_REQUIRED };
  }
  // 403 REAUTH_REQUIRED and 429 TOO_MANY_ATTEMPTS carry a message written for the user.
  if ((status === 403 || status === 429) && data.message) return { field: null, message: data.message };
  return { field: null, message: DELETE_MESSAGES.FAILED };
};

// Deletes the account, then signs out locally the same way the auth store's logout does
// (tokens + cached user + store state) minus the /auth/logout call, which a deleted user can't make.
const useDeleteAccount = () => {
  const navigate = useNavigate();
  const inFlight = useRef(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteAccount = useCallback((password) => {
    // A second submit while the first is pending reuses it instead of sending another request.
    if (inFlight.current) return inFlight.current;

    const run = async () => {
      const userIds = cachedUserIds(localStorage, useAuthStore.getState().user);
      setIsDeleting(true);
      try {
        await deleteAccountRequest(password);
      } catch (err) {
        setIsDeleting(false);
        return { ok: false, ...toDeleteError(err) };
      }

      removeToken();
      try {
        clearAccountLocalData(localStorage, userIds);
      } catch {
        // storage unavailable: nothing more to clear
      }
      // Navigate before dropping auth so the protected route doesn't redirect elsewhere first.
      navigate(ROUTES.LOGIN, { replace: true });
      useAuthStore.setState({
        user: null,
        userStats: null,
        isAuthenticated: false,
        loading: false,
        error: null,
        successMessage: DELETE_MESSAGES.DELETED,
      });
      return { ok: true };
    };

    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [navigate]);

  return { deleteAccount, isDeleting };
};

export default useDeleteAccount;
