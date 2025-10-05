/**
 * The API wraps payloads as { code, success, message, data }.
 * Returns the payload (plus the message) for an axios response.
 */
export const unwrapEnvelope = (response) => {
  const body = response.data;
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    return { ...(body.data || {}), message: body.message };
  }
  return body;
};
