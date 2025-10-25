/**
 * Maps an AI Coach chat failure (axios error or plain Error) to a
 * user-facing message. Pure and dependency-free so it can run under node --test.
 *
 * @returns {{ type: 'rate_limit'|'network'|'auth'|'ai_unavailable'|'server'|'bad_request'|'unknown', message: string }}
 */

const formatWait = (seconds) => {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.ceil(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

const getRetryAfterSeconds = (headers) => {
  const raw = headers?.['retry-after'];
  if (raw === undefined || raw === null || raw === '') return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.ceil(seconds);
};

export const getChatErrorMessage = (error) => {
  const response = error?.response;

  if (!response) {
    if (error?.request || error?.code === 'ERR_NETWORK' || error?.code === 'ECONNABORTED') {
      return {
        type: 'network',
        message: "I'm having trouble connecting right now. Please check your internet connection and try again.",
      };
    }
    return {
      type: 'unknown',
      message: 'Something went wrong while getting a response. Please try again.',
    };
  }

  const { status } = response;
  const body = response.data && typeof response.data === 'object' ? response.data : {};
  const errorCode = body.errorCode;

  if (status === 429) {
    const retryAfter = getRetryAfterSeconds(response.headers);
    const wait = retryAfter ? `in ${formatWait(retryAfter)}` : 'in a moment';
    if (errorCode === 'AI_RATE_LIMITED') {
      return {
        type: 'rate_limit',
        message: `The AI service has reached its usage limit. Please try again ${wait}.`,
      };
    }
    return {
      type: 'rate_limit',
      message: `You're sending messages too quickly. Please wait and try again ${wait}.`,
    };
  }

  if (status === 401) {
    return {
      type: 'auth',
      message: 'Your session has expired. Please log in again.',
    };
  }

  if (status === 400) {
    return {
      type: 'bad_request',
      message: body.message || "I couldn't process that message. Please rephrase it and try again.",
    };
  }

  if (status === 503 && (errorCode === 'AI_NOT_CONFIGURED' || errorCode === 'AI_AUTH_ERROR')) {
    return {
      type: 'ai_unavailable',
      message: 'The AI Coach is unavailable because the AI service is not configured correctly. Please contact the administrator.',
    };
  }

  if (status === 502 || errorCode === 'AI_PROVIDER_ERROR') {
    return {
      type: 'server',
      message: 'The AI service returned an error. Please try again in a moment.',
    };
  }

  if (status >= 500) {
    return {
      type: 'server',
      message: 'Something went wrong on our end. Please try again later.',
    };
  }

  return {
    type: 'unknown',
    message: body.message || 'Something went wrong while getting a response. Please try again.',
  };
};

export default getChatErrorMessage;
