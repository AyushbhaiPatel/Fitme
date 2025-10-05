// Idempotency key for POST /workouts/complete. One id per workout session: generated on "Start Workout",
// kept through "Continue Workout", failed-save retries and a resume after reload; a new session gets a new id.

export const CLIENT_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const isValidClientSessionId = (id) => typeof id === 'string' && CLIENT_SESSION_ID_PATTERN.test(id);

const FALLBACK_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * `crypto.randomUUID()` when available, otherwise `ws_<time base36>_<20 random chars>` (all `[A-Za-z0-9_-]`).
 * Dependencies are injectable for tests.
 */
export const generateClientSessionId = ({
  cryptoImpl = globalThis.crypto,
  random = Math.random,
  now = Date.now,
} = {}) => {
  try {
    if (cryptoImpl && typeof cryptoImpl.randomUUID === 'function') {
      const id = cryptoImpl.randomUUID();
      if (isValidClientSessionId(id)) return id;
    }
  } catch {
    // insecure context or broken implementation: use the fallback
  }

  const bytes = new Array(20);
  let filled = false;
  try {
    if (cryptoImpl && typeof cryptoImpl.getRandomValues === 'function') {
      const buf = cryptoImpl.getRandomValues(new Uint8Array(20));
      for (let i = 0; i < 20; i += 1) bytes[i] = buf[i];
      filled = true;
    }
  } catch {
    filled = false;
  }
  if (!filled) {
    for (let i = 0; i < 20; i += 1) bytes[i] = Math.floor(random() * 256);
  }
  const suffix = bytes.map((b) => FALLBACK_ALPHABET[Math.abs(Number(b) || 0) % FALLBACK_ALPHABET.length]).join('');
  const time = Math.abs(Math.floor(Number(now()) || 0)).toString(36);
  return `ws_${time}_${suffix}`.slice(0, 64);
};

/** The session's existing id when valid, otherwise a fresh one. Used on start, never on retry/continue. */
export const ensureClientSessionId = (existingId, options) =>
  (isValidClientSessionId(existingId) ? existingId : generateClientSessionId(options));
