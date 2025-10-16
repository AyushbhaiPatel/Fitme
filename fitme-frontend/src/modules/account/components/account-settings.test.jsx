import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, act, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../services', () => ({ deleteAccount: vi.fn() }));

import { deleteAccount } from '../services';
import { useAuthStore } from '../../../store/auth-store';
import AccountSettings from './account-settings';
import useDeleteAccount from '../hooks/use-delete-account';

const USER = { id: 'u1', _id: 'u1', firstName: 'Sam', email: 'sam@example.test', profileCompleted: true };

const httpError = (status, data = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const renderPage = () => {
  render(
    <MemoryRouter initialEntries={['/dashboard/settings']}>
      <Routes>
        <Route path="/dashboard/settings" element={<AccountSettings />} />
        <Route path="/login" element={<h1>Login page</h1>} />
      </Routes>
    </MemoryRouter>
  );
};

const openDialog = async (user) => {
  await user.click(screen.getByRole('button', { name: /^Delete Account$/ }));
  return screen.getByRole('dialog', { name: 'Delete your account' });
};

const fill = async (user, { password, confirm }) => {
  if (password !== undefined) await user.type(screen.getByLabelText('Current password'), password);
  if (confirm !== undefined) await user.type(screen.getByLabelText('Type DELETE to confirm'), confirm);
};

const submit = (user) => user.click(screen.getByRole('button', { name: 'Delete account permanently' }));

beforeEach(() => {
  deleteAccount.mockReset();
  localStorage.setItem('fitme_token', 'access');
  localStorage.setItem('fitme_refresh_token', 'refresh');
  localStorage.setItem('fitme_user', JSON.stringify(USER));
  localStorage.setItem('fitme:u1:nutrition_log_2026-11-14', '[]');
  localStorage.setItem('fitme:u2:nutrition_log_2026-11-14', '[]');
  useAuthStore.setState({ user: USER, isAuthenticated: true, isInitialized: true, loading: false });
});

describe('useDeleteAccount', () => {
  test('calls made while one is in flight share it instead of sending another request', async () => {
    const pending = deferred();
    deleteAccount.mockReturnValue(pending.promise);
    const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;
    const { result } = renderHook(() => useDeleteAccount(), { wrapper });

    let first;
    let second;
    act(() => {
      first = result.current.deleteAccount('Str0ng!Pass');
      second = result.current.deleteAccount('Str0ng!Pass');
    });
    expect(second).toBe(first);
    expect(deleteAccount).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve({ success: true }); await first; });
    await expect(first).resolves.toEqual({ ok: true });
  });
});

describe('delete account dialog', () => {
  test('requires the current password and the typed confirmation before calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);

    await submit(user);
    expect(screen.getByText('Enter your current password to delete your account.')).toBeInTheDocument();
    expect(screen.getByText('Type DELETE to confirm.')).toBeInTheDocument();

    await fill(user, { password: 'Str0ng!Pass', confirm: 'delete' });
    await submit(user);
    expect(screen.getByText('Type DELETE to confirm.')).toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  test('a wrong password shows an inline error and keeps the user signed in', async () => {
    deleteAccount.mockRejectedValueOnce(httpError(400, { message: 'Incorrect password', errorCode: 'INCORRECT_PASSWORD' }));
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user, { password: 'wrong pass ', confirm: 'DELETE' });
    await submit(user);

    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(deleteAccount).toHaveBeenCalledWith('wrong pass '); // sent exactly as typed
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(localStorage.getItem('fitme_token')).toBe('access');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  test('a server failure shows a form error', async () => {
    deleteAccount.mockRejectedValueOnce(httpError(500, { message: 'Something went wrong!' }));
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user, { password: 'Str0ng!Pass', confirm: 'DELETE' });
    await submit(user);

    expect(await screen.findByText("We couldn't delete your account. Please try again.")).toBeInTheDocument();
    expect(localStorage.getItem('fitme_user')).not.toBeNull();
  });

  test('re-authentication and lockout messages from the server are shown as-is', async () => {
    const msg = 'Too many incorrect password attempts. Try again in 15 minutes.';
    deleteAccount.mockRejectedValueOnce(httpError(429, { message: msg, errorCode: 'TOO_MANY_ATTEMPTS' }));
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user, { password: 'Str0ng!Pass', confirm: 'DELETE' });
    await submit(user);
    expect(await screen.findByText(msg)).toBeInTheDocument();
  });

  test('double submit sends one request; success clears local data and goes to the login page', async () => {
    const pending = deferred();
    deleteAccount.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDialog(user);
    await fill(user, { password: 'Str0ng!Pass', confirm: 'DELETE' });

    const form = dialog.querySelector('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Deleting account...')).toBeInTheDocument();

    pending.resolve({ success: true });
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument();

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    for (const key of ['fitme_token', 'fitme_refresh_token', 'fitme_user', 'fitme:u1:nutrition_log_2026-11-14']) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem('fitme:u2:nutrition_log_2026-11-14')).toBe('[]');
    await waitFor(() => expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      successMessage: 'Your account has been deleted.',
    }));
  });
});
