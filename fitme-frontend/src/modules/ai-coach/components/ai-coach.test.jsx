import React, { StrictMode } from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const USER = { id: 'u1', _id: 'u1', firstName: 'Sam', email: 'sam@example.test', profileCompleted: true };
const SUGGESTIONS = ['How much protein do I need?', 'Plan me a leg day'];
const INPUT_PLACEHOLDER = /Ask about workouts, nutrition/;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// Real backend envelope, as axios would hand it back
const envelope = (data, message = 'Success') => ({ status: 200, data: { code: 200, success: true, message, data } });

const httpError = (status, data = {}, headers = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config: {},
    request: {},
    response: { status, data, headers },
  });

const networkError = () =>
  Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK', config: {}, request: {} });

let axiosClient;
let api; // per-test deferreds for each endpoint

// Fresh module graph per test: auth store, in-flight /auth/me and the module-level suggestions cache are all reset.
const renderPage = async () => {
  vi.resetModules();
  ({ default: axiosClient } = await import('../../../services/api-service/axios-client'));
  const { AuthProvider } = await import('../../../context/auth-context');
  const { default: AppRoutes } = await import('../../../routes/index');

  vi.spyOn(axiosClient, 'get').mockImplementation((url) => {
    if (url === '/auth/me') return api.me.promise;
    if (url === '/aicoach/suggestions') return api.suggestions.promise;
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  vi.spyOn(axiosClient, 'post').mockImplementation((url) => {
    if (url === '/aicoach/chat') return api.chat();
    return Promise.reject(new Error(`unexpected POST ${url}`));
  });

  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/dashboard/ai-coach']}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>
  );
};

const callsTo = (method, url) => axiosClient[method].mock.calls.filter(([u]) => u === url).length;

const resolveSuggestions = async () => {
  await act(async () => { api.suggestions.resolve(envelope({ suggestions: SUGGESTIONS })); });
  await screen.findByText(SUGGESTIONS[0]);
};

beforeEach(() => {
  localStorage.setItem('fitme_token', 'test-token');
  localStorage.setItem('fitme_user', JSON.stringify(USER));
  api = {
    me: deferred(),
    suggestions: deferred(),
    chat: vi.fn(() => Promise.resolve(envelope({ response: 'Default reply', recipes: null, timestamp: new Date().toISOString() }))),
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI Coach page load', () => {
  test('renders the layout immediately from the cached user while /auth/me and suggestions are pending', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Fitness AI' })).toBeInTheDocument();
    expect(screen.getByText('Suggested Questions')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading suggestions' })).toBeInTheDocument();
    expect(screen.getByText(/Hello Sam!/)).toBeInTheDocument();
    // No full-screen spinner
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  test('requests /auth/me and suggestions exactly once (StrictMode, and after /auth/me replaces the user)', async () => {
    await renderPage();
    expect(callsTo('get', '/auth/me')).toBe(1);
    expect(callsTo('get', '/aicoach/suggestions')).toBe(1);

    // /auth/me returns a new user object with the same id
    await act(async () => {
      api.me.resolve({ data: { code: 200, success: true, message: 'Success', data: { user: { ...USER, firstName: 'Samuel' } } } });
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    await resolveSuggestions();

    expect(callsTo('get', '/auth/me')).toBe(1);
    expect(callsTo('get', '/aicoach/suggestions')).toBe(1);
  });

  test('overlapping getCurrentUser callers share one /auth/me request', async () => {
    vi.resetModules();
    ({ default: axiosClient } = await import('../../../services/api-service/axios-client'));
    const { useAuthStore } = await import('../../../store/auth-store');
    vi.spyOn(axiosClient, 'get').mockImplementation(() => api.me.promise);

    const { getCurrentUser } = useAuthStore.getState();
    const a = getCurrentUser({ silent: true });
    const b = getCurrentUser();
    expect(axiosClient.get).toHaveBeenCalledTimes(1);
    api.me.resolve({ data: { code: 200, success: true, message: 'Success', data: { user: USER } } });
    expect(await a).toEqual(USER);
    expect(await b).toEqual(USER);
    expect(useAuthStore.getState().loading).toBe(false);

    // Once settled, a later call makes a new request
    getCurrentUser({ silent: true });
    expect(axiosClient.get).toHaveBeenCalledTimes(2);
  });

  test('shows suggestions from the API envelope and removes the skeleton', async () => {
    await renderPage();
    expect(screen.getByRole('status', { name: 'Loading suggestions' })).toBeInTheDocument();

    await resolveSuggestions();

    for (const s of SUGGESTIONS) expect(screen.getByRole('button', { name: s })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading suggestions' })).not.toBeInTheDocument();
  });
});

describe('sending a message', () => {
  test('calls the chat API once and renders the reply from data.response', async () => {
    const user = userEvent.setup();
    await renderPage();
    await resolveSuggestions();
    api.chat.mockImplementation(() =>
      Promise.resolve(envelope({ response: 'Try **3 sets** of squats', recipes: null, timestamp: new Date().toISOString() }))
    );

    await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'Leg day ideas?');
    await user.keyboard('{Enter}{Enter}');

    expect(await screen.findByText('Try 3 sets of squats')).toBeInTheDocument();
    expect(screen.getByText('Leg day ideas?')).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledTimes(1);
    expect(axiosClient.post).toHaveBeenCalledWith('/aicoach/chat', { message: 'Leg day ideas?', conversationHistory: expect.any(Array) });
  });

  test('two Enters in the same tick send only once (in-flight guard)', async () => {
    await renderPage();
    await resolveSuggestions();
    const reply = deferred();
    api.chat.mockImplementation(() => reply.promise);

    const input = screen.getByPlaceholderText(INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'Hello coach' } });
    // Both events dispatched before React re-renders, so only the ref guard can stop the second one
    act(() => {
      fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });
      fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    });
    expect(api.chat).toHaveBeenCalledTimes(1);

    await act(async () => { reply.resolve(envelope({ response: 'Hi there', recipes: null })); });
    expect(await screen.findByText('Hi there')).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledTimes(1);
  });

  test('Enter followed by a click on Send in the same tick sends only once', async () => {
    await renderPage();
    await resolveSuggestions();
    const reply = deferred();
    api.chat.mockImplementation(() => reply.promise);

    const input = screen.getByPlaceholderText(INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'Hello again' } });
    const send = screen.getByRole('button', { name: 'Send message' });
    act(() => {
      fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });
      fireEvent.click(send);
    });
    expect(api.chat).toHaveBeenCalledTimes(1);

    await act(async () => { reply.resolve(envelope({ response: 'Welcome back', recipes: null })); });
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledTimes(1);
  });
});

describe('chat error messages', () => {
  const cases = [
    {
      name: 'our rate limit (429 RATE_LIMITED + Retry-After)',
      error: () => httpError(429, { success: false, message: 'Too many chat requests.', errorCode: 'RATE_LIMITED' }, { 'retry-after': '30' }),
      expected: "You're sending messages too quickly. Please wait and try again in 30 seconds.",
    },
    {
      name: 'provider rate limit (429 AI_RATE_LIMITED)',
      error: () => httpError(429, { success: false, message: 'busy', errorCode: 'AI_RATE_LIMITED' }),
      expected: 'The AI service has reached its usage limit. Please try again in a moment.',
    },
    {
      name: 'network error (no response)',
      error: networkError,
      expected: "I'm having trouble connecting right now. Please check your internet connection and try again.",
    },
    {
      name: 'auth (401)',
      error: () => httpError(401, { success: false, message: 'Token has expired. Please login again.', code: 'TOKEN_EXPIRED' }),
      expected: 'Your session has expired. Please log in again.',
    },
    {
      name: 'server (500)',
      error: () => httpError(500, { success: false, message: 'Something went wrong!' }),
      expected: 'Something went wrong on our end. Please try again later.',
    },
    {
      name: 'provider error (502 AI_PROVIDER_ERROR)',
      error: () => httpError(502, { success: false, message: 'x', errorCode: 'AI_PROVIDER_ERROR' }),
      expected: 'The AI service returned an error. Please try again in a moment.',
    },
    {
      name: 'AI misconfigured (503 AI_AUTH_ERROR)',
      error: () => httpError(503, { success: false, message: 'x', errorCode: 'AI_AUTH_ERROR' }),
      expected: 'The AI Coach is unavailable because the AI service is not configured correctly. Please contact the administrator.',
    },
  ];

  test('expected messages are all different', () => {
    expect(new Set(cases.map((c) => c.expected)).size).toBe(cases.length);
  });

  for (const c of cases) {
    test(`shows the right message for ${c.name}`, async () => {
      // Capture the 2s login redirect the 401 path schedules instead of letting it fire
      const realSetTimeout = globalThis.setTimeout;
      const redirects = [];
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...rest) => {
        if (ms === 2000) { redirects.push(fn); return 0; }
        return realSetTimeout(fn, ms, ...rest);
      });

      const user = userEvent.setup();
      await renderPage();
      await resolveSuggestions();
      api.chat.mockImplementation(() => Promise.reject(c.error()));

      await user.type(screen.getByPlaceholderText(INPUT_PLACEHOLDER), 'Hi{Enter}');

      const bubble = await screen.findByText(c.expected);
      expect(within(bubble.parentElement).getByText('Error')).toBeInTheDocument();
      expect(api.chat).toHaveBeenCalledTimes(1);
      // Only the auth error schedules a redirect to /login
      expect(redirects).toHaveLength(c.name.startsWith('auth') ? 1 : 0);
      // Input is usable again after the failure
      await waitFor(() => expect(screen.getByPlaceholderText(INPUT_PLACEHOLDER)).not.toBeDisabled());
    });
  }
});
