import { useCallback } from 'react';
import { deleteAccount } from '../services';

const useDeleteAccount = () => {
  return useCallback((password) => deleteAccount(password), []);
};

export default useDeleteAccount;
