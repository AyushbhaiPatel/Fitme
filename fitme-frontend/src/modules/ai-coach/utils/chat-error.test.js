import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getChatErrorMessage } from './chat-error.js';

const httpError = (status, data = {}, headers = {}) => ({ response: { status, data, headers }, request: {} });

describe('getChatErrorMessage', () => {
  test('our per-user limiter (429 RATE_LIMITED) uses Retry-After seconds', () => {
    const r = getChatErrorMessage(httpError(429, { errorCode: 'RATE_LIMITED' }, { 'retry-after': '42' }));
    assert.equal(r.type, 'rate_limit');
    assert.match(r.message, /sending messages too quickly/);
    assert.match(r.message, /in 42 seconds/);
  });

  test('Retry-After over a minute is rounded up to minutes; singular units', () => {
    assert.match(getChatErrorMessage(httpError(429, {}, { 'retry-after': '61' })).message, /in 2 minutes/);
    assert.match(getChatErrorMessage(httpError(429, {}, { 'retry-after': '1' })).message, /in 1 second\./);
    assert.match(getChatErrorMessage(httpError(429, {}, { 'retry-after': '60' })).message, /in 1 minute\./);
  });

  test('missing or invalid Retry-After falls back to "in a moment"', () => {
    for (const v of [undefined, '', 'soon', '0', '-5']) {
      const headers = v === undefined ? {} : { 'retry-after': v };
      assert.match(getChatErrorMessage(httpError(429, {}, headers)).message, /in a moment\./);
    }
  });

  test('provider rate limit (429 AI_RATE_LIMITED) is a distinct message', () => {
    const ours = getChatErrorMessage(httpError(429, { errorCode: 'RATE_LIMITED' }));
    const provider = getChatErrorMessage(httpError(429, { errorCode: 'AI_RATE_LIMITED' }));
    assert.equal(provider.type, 'rate_limit');
    assert.match(provider.message, /AI service has reached its usage limit/);
    assert.notEqual(provider.message, ours.message);
  });

  test('network errors (no response)', () => {
    for (const err of [{ request: {} }, { code: 'ERR_NETWORK' }, { code: 'ECONNABORTED' }]) {
      const r = getChatErrorMessage(err);
      assert.equal(r.type, 'network');
      assert.match(r.message, /trouble connecting/);
    }
  });

  test('plain Error without request is unknown', () => {
    assert.equal(getChatErrorMessage(new Error('boom')).type, 'unknown');
    assert.equal(getChatErrorMessage(undefined).type, 'unknown');
  });

  test('401 -> auth', () => {
    const r = getChatErrorMessage(httpError(401, { message: 'Token has expired' }));
    assert.equal(r.type, 'auth');
    assert.match(r.message, /session has expired/);
  });

  test('400 uses the server message when present', () => {
    assert.deepEqual(getChatErrorMessage(httpError(400, { message: 'Message is required' })), { type: 'bad_request', message: 'Message is required' });
    assert.equal(getChatErrorMessage(httpError(400, null)).type, 'bad_request');
  });

  test('503 AI_AUTH_ERROR / AI_NOT_CONFIGURED -> ai_unavailable', () => {
    for (const errorCode of ['AI_AUTH_ERROR', 'AI_NOT_CONFIGURED']) {
      const r = getChatErrorMessage(httpError(503, { errorCode }));
      assert.equal(r.type, 'ai_unavailable');
      assert.match(r.message, /not configured correctly/);
    }
  });

  test('502 AI_PROVIDER_ERROR vs generic 500 are both server errors with different messages', () => {
    const provider = getChatErrorMessage(httpError(502, { errorCode: 'AI_PROVIDER_ERROR' }));
    const generic = getChatErrorMessage(httpError(500, { message: 'Internal server error' }));
    assert.equal(provider.type, 'server');
    assert.equal(generic.type, 'server');
    assert.match(provider.message, /AI service returned an error/);
    assert.match(generic.message, /went wrong on our end/);
  });

  test('every category produces a distinct message', () => {
    const messages = [
      getChatErrorMessage(httpError(429, { errorCode: 'RATE_LIMITED' })),
      getChatErrorMessage(httpError(429, { errorCode: 'AI_RATE_LIMITED' })),
      getChatErrorMessage({ request: {} }),
      getChatErrorMessage(httpError(401)),
      getChatErrorMessage(httpError(500)),
      getChatErrorMessage(httpError(502, { errorCode: 'AI_PROVIDER_ERROR' })),
      getChatErrorMessage(httpError(503, { errorCode: 'AI_AUTH_ERROR' })),
    ].map((r) => r.message);
    assert.equal(new Set(messages).size, messages.length);
  });
});
