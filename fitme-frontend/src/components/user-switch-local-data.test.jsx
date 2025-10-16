import React, { StrictMode } from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

// Keep the public home page (logout lands there) out of this test.
vi.mock('../modules/home/components/home-page', () => ({ default: () => <h1>Home page</h1> }));

const USER_A = { id: 'uA', _id: 'uA', firstName: 'Alice', profileCompleted: true };
const USER_B_LOGIN = { id: 'uB', firstName: 'Bea', profileCompleted: true }; // login response shape: `id` only
const A_SECRET = 'Alice private: my injury history';
const A_CHAT = JSON.stringify([
  { id: 1, type: 'user', content: A_SECRET, timestamp: '2026-11-13T10:00:00.000Z' },
  { id: 2, type: 'bot', content: 'Alice reply from coach', timestamp: '2026-11-13T10:00:01.000Z' },
]);
const A_PLANS = JSON.stringify([{ id: 'local-1', goal: 'Alice plan' }]);
const INPUT_PLACEHOLDER = /Ask about workouts, nutrition/;

const pending = () => new Promise(() => {});
const envelope = (data) => ({ status: 200, data: { code: 200, success: true, message: 'Success', data } });

let axiosClient;
let useAuthStore;
let navigateTo;
let me;

const NavProbe = () => {
  navigateTo = useNavigate();
  return null;
};

// Fresh module graph per test so the auth store and axios instance start clean.
const renderApp = async (path) => {
  vi.resetModules();
  ({ default: axiosClient } = await import('../services/api-service/axios-client'));
  ({ useAuthStore } = await import('../store/auth-store'));
  const { AuthProvider } = await import('../context/auth-context');
  const { default: AppRoutes } = await import('../routes/index');

  vi.spyOn(axiosClient, 'get').mockImplementation((url) => {
    if (url === '/auth/me') return me();
    return pending(); // suggestions etc.: irrelevant here
  });
  vi.spyOn(axiosClient, 'post').mockImplementation((url) => {
    if (url === '/auth/logout') return Promise.resolve(envelope({}));
    if (url === '/auth/login') return Promise.resolve(envelope({ user: USER_B_LOGIN, tokens: { accessToken: 'b-access', refreshToken: 'b-refresh' } }));
    if (url === '/aicoach/chat') return Promise.resolve(envelope({ response: 'Reply for Bea', recipes: null }));
    return Promise.reject(new Error(`unexpected POST ${url}`));
  });

  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <NavProbe />
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>
  );
};

const seedUserA = () => {
  localStorage.setItem('fitme_token', 'a-access');
  localStorage.setItem('fitme_refresh_token', 'a-refresh');
  localStorage.setItem('fitme_user', JSON.stringify(USER_A));
  localStorage.setItem('fitme_last_user_id', 'uA');
  localStorage.setItem('aicoach_messages', A_CHAT);
  localStorage.setItem('fitme_saved_plans', A_PLANS);
};

const signInAsB = async () => {
  await act(async () => { await useAuthStore.getState().login('bea@example.test', 'pw'); });
  await act(async () => { navigateTo('/dashboard/ai-coach'); });
};

const expectNoTraceOfA = () => {
  expect(localStorage.getItem('fitme_saved_plans')).toBeNull();
  expect(localStorage.getItem('aicoach_messages') ?? '').not.toContain('Alice');
  expect(screen.queryByText(A_SECRET)).not.toBeInTheDocument();
  expect(screen.queryByText('Alice reply from coach')).not.toBeInTheDocument();
};

beforeEach(() => {
  me = pending;
  seedUserA();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('switching users in one browser', () => {
  test('logout from the sidebar clears the chat and saved plans; user B then sees none of A’s messages', async () => {
    await renderApp('/dashboard/ai-coach');
    expect(screen.getByText(A_SECRET)).toBeInTheDocument();

    fireEvent.mouseEnter(document.querySelector('.hidden.md\\:block')); // expand sidebar so Logout has a label
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Logout' }).at(-1)); });

    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeInTheDocument();
    expect(localStorage.getItem('aicoach_messages')).toBeNull();
    expect(localStorage.getItem('fitme_saved_plans')).toBeNull();
    expect(localStorage.getItem('fitme_token')).toBeNull();

    await signInAsB();
    expect(await screen.findByText(/Hello Bea!/)).toBeInTheDocument();
    expectNoTraceOfA();
  });

  test('a logout path that leaves the keys behind (store logout only) is caught before the AI Coach page reads them', async () => {
    await renderApp('/dashboard/ai-coach');
    expect(screen.getByText(A_SECRET)).toBeInTheDocument();

    // The store's own logout does not know about the unscoped keys.
    await act(async () => { await useAuthStore.getState().logout(); });
    await act(async () => { navigateTo('/'); });
    expect(localStorage.getItem('aicoach_messages')).toContain(A_SECRET);

    await signInAsB();
    expect(await screen.findByText(/Hello Bea!/)).toBeInTheDocument();
    expectNoTraceOfA();
    expect(localStorage.getItem('fitme_last_user_id')).toBe('uB');

    // B's first message must not carry A's conversation to the AI.
    fireEvent.change(screen.getByPlaceholderText(INPUT_PLACEHOLDER), { target: { value: 'Hi coach' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Reply for Bea')).toBeInTheDocument();
    const [, body] = axiosClient.post.mock.calls.find(([u]) => u === '/aicoach/chat');
    expect(JSON.stringify(body.conversationHistory)).not.toContain('Alice');
  });

  test('the same user reloading (and /auth/me replacing the login user) keeps their own chat', async () => {
    // Cached login user has `id` only; /auth/me answers with `_id` only.
    localStorage.setItem('fitme_user', JSON.stringify({ id: 'uA', firstName: 'Alice', profileCompleted: true }));
    me = () => Promise.resolve(envelope({ user: { _id: 'uA', firstName: 'Alice', profileCompleted: true } }));

    await renderApp('/dashboard/ai-coach');
    expect(screen.getByText(A_SECRET)).toBeInTheDocument();
    await waitFor(() => expect(useAuthStore.getState().user).toEqual(expect.objectContaining({ _id: 'uA' })));

    expect(screen.getByText(A_SECRET)).toBeInTheDocument();
    expect(localStorage.getItem('aicoach_messages')).toContain(A_SECRET);
    expect(localStorage.getItem('fitme_saved_plans')).toBe(A_PLANS);
    expect(localStorage.getItem('fitme_last_user_id')).toBe('uA');
  });
});

describe('forced logout after a failed token refresh', () => {
  test('clears the chat and saved plans along with the session', async () => {
    vi.resetModules();
    const { default: client } = await import('../services/api-service/axios-client');
    // Every request 401s, including /auth/refresh, so the interceptor gives up and signs out.
    client.defaults.adapter = (config) =>
      Promise.reject(Object.assign(new Error('Unauthorized'), { config, response: { status: 401, data: {}, config } }));

    await expect(client.get('/workouts')).rejects.toThrow('Unauthorized');

    for (const key of ['fitme_token', 'fitme_refresh_token', 'fitme_user', 'aicoach_messages', 'fitme_saved_plans']) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });
});
