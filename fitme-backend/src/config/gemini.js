const { GoogleGenerativeAI } = require('@google/generative-ai');

// gemini-2.5-flash was retired by Google (404 on generateContent). Override with GEMINI_MODEL.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

let genAI = null;
let defaultModel = null;

const initGemini = () => {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY not configured');
    return;
  }
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    defaultModel = genAI.getGenerativeModel({
      model: DEFAULT_MODEL,
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 },
    });
    console.log('✅ Gemini client initialized');
  } catch (err) {
    console.error('❌ Gemini init failed:', err.message);
  }
};

const getModel = (overrides = {}) => {
  if (!genAI) return null;
  if (Object.keys(overrides).length === 0) return defaultModel;
  return genAI.getGenerativeModel({
    model: overrides.model || DEFAULT_MODEL,
    generationConfig: {
      temperature: overrides.temperature ?? 0.7,
      topK: overrides.topK ?? 40,
      topP: overrides.topP ?? 0.95,
      maxOutputTokens: overrides.maxOutputTokens ?? 8192,
      // Thinking tokens count against maxOutputTokens; callers with small caps pass a low level
      // so the visible reply isn't truncated or empty.
      ...(overrides.thinkingLevel ? { thinkingConfig: { thinkingLevel: overrides.thinkingLevel } } : {}),
    },
  });
};

const isAvailable = () => !!defaultModel;

// Retry policy for provider 429s. Mutable so tests can set baseDelayMs to 0.
// A 429 whose provider-suggested wait exceeds maxRetryAfterSeconds (e.g. an exhausted daily quota) is not retried.
const retryConfig = { maxAttempts: 3, baseDelayMs: 500, maxRetryAfterSeconds: 10 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (err) => err?.status === 429;

// Seconds the provider asked us to wait (google.rpc.RetryInfo, e.g. "57763s"), or null.
const getRetryAfterSeconds = (err) => {
  const info = Array.isArray(err?.errorDetails) ? err.errorDetails.find((d) => d?.retryDelay) : null;
  const seconds = info ? Math.ceil(parseFloat(info.retryDelay)) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

const isAuthError = (err) => {
  if (err?.status === 401 || err?.status === 403) return true;
  if (err?.status !== 400) return false;
  const details = err.errorDetails ? JSON.stringify(err.errorDetails) : '';
  return details.includes('API_KEY_INVALID') || /API_KEY_INVALID|API key not valid/i.test(err.message || '');
};

const redactKey = (text) => {
  const key = process.env.GEMINI_API_KEY;
  return key && typeof text === 'string' ? text.split(key).join('[REDACTED]') : text;
};

const logProviderError = (label, err, attempt, maxAttempts) => {
  console.error(`[${label}] Gemini error (attempt ${attempt}/${maxAttempts}):`, {
    status: err?.status,
    statusText: err?.statusText,
    message: redactKey(err?.message),
    errorDetails: err?.errorDetails,
  });
};

// Retries with exponential backoff only on provider 429; every other error is thrown immediately.
const generateContent = async (prompt, overrides = {}, { label = 'gemini' } = {}) => {
  // Resolved through module.exports so tests can stub getModel with a fake model.
  const model = module.exports.getModel(overrides);
  if (!model) throw new Error('Gemini not initialized');
  const { maxAttempts, baseDelayMs, maxRetryAfterSeconds } = retryConfig;
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return (await result.response).text();
    } catch (err) {
      logProviderError(label, err, attempt, maxAttempts);
      if (!isRateLimitError(err) || attempt >= maxAttempts) throw err;
      if ((getRetryAfterSeconds(err) ?? 0) > maxRetryAfterSeconds) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
};

initGemini();

module.exports = { initGemini, getModel, isAvailable, generateContent, retryConfig, isRateLimitError, isAuthError, getRetryAfterSeconds };
