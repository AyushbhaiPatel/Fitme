const http = require('http');
const { Format } = require('../config/format');

// Central mapping from thrown errors to the API envelope { code, success, message, ... }.
// Predictable client errors (bad input, malformed ids, duplicates, bad JSON) become 4xx;
// anything else is a generic 500. Responses never carry stack traces, raw error objects,
// submitted values or internal paths.

const GENERIC_500 = 'Something went wrong!';

// 'workoutHistory.0.durationSeconds' -> 'Duration seconds', '_id' -> 'id'
const fieldLabel = (path) => {
  const last = String(path || '').split('.').filter((p) => p && !/^\d+$/.test(p)).pop() || '';
  if (!last) return 'value';
  if (last === '_id' || last === 'id') return 'id';
  const words = last.replace(/^_+/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const isDefaultMongooseMessage = (msg) =>
  /^Path `/.test(msg) || /is not a valid enum value for path/.test(msg) || /^Validator failed for path/.test(msg) || /^Cast to /.test(msg);

// Mongoose's default messages embed the submitted value (e.g. a too-short password).
// Use the schema's custom message only when it is safe; otherwise build one from the validator kind.
const safeValidatorMessage = (e) => {
  const label = fieldLabel(e.path);
  if (e.name === 'CastError') return `Invalid ${label.toLowerCase()}`;

  const msg = typeof e.message === 'string' ? e.message : '';
  const value = e.value ?? e.properties?.value;
  const valueStr = value === undefined || value === null || typeof value === 'object' ? '' : String(value);
  const echoesValue = valueStr !== '' && msg.includes(valueStr);
  if (msg && !isDefaultMongooseMessage(msg) && !echoesValue && !/password/i.test(e.path || '')) return msg;

  const p = e.properties || {};
  switch (e.kind) {
    case 'required': return `${label} is required`;
    case 'enum': return `Invalid ${label.toLowerCase()} value`;
    case 'min': return `${label} must be at least ${p.min}`;
    case 'max': return `${label} must be at most ${p.max}`;
    case 'minlength': return `${label} must be at least ${p.minlength} characters`;
    case 'maxlength': return `${label} must be at most ${p.maxlength} characters`;
    case 'regexp': return `${label} is invalid`;
    default: return `Invalid ${label.toLowerCase()}`;
  }
};

const mapValidationError = (err) => {
  const errors = Object.values(err.errors || {}).map((e) => ({ field: e.path, message: safeValidatorMessage(e) }));
  return Format.badRequest(errors[0]?.message || 'Validation failed', errors.length ? errors : null);
};

const DUPLICATE_MESSAGES = {
  email: 'Email is already taken',
  username: 'Username is already taken',
};

const mapDuplicateKey = (err) => {
  // keyPattern names the indexed field; keyValue (the submitted value) is never echoed.
  const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
  const message = DUPLICATE_MESSAGES[field] || (field ? `A record with this ${fieldLabel(field).toLowerCase()} already exists` : 'Resource already exists');
  const res = Format.conflict(message);
  if (field) res.errors = [{ field, message }];
  return res;
};

const BODY_PARSER_MESSAGES = {
  'entity.parse.failed': 'Malformed JSON in request body',
  'entity.too.large': 'Request body is too large',
  'encoding.unsupported': 'Unsupported content encoding',
  'charset.unsupported': 'Unsupported charset',
  'request.aborted': 'Request aborted',
  'request.size.invalid': 'Request size did not match content length',
  'parameters.too.many': 'Too many parameters',
};

const JWT_ERRORS = {
  TokenExpiredError: { message: 'Token has expired. Please login again.', errorCode: 'TOKEN_EXPIRED' },
  JsonWebTokenError: { message: 'Invalid token. Please login again.', errorCode: 'INVALID_TOKEN' },
  NotBeforeError: { message: 'Invalid token. Please login again.', errorCode: 'INVALID_TOKEN' },
};

/**
 * Map any thrown value to a response envelope. Pure: no logging, no res access.
 * @returns {{ code: number, success: false, message: string, [k: string]: any }}
 */
const mapError = (err) => {
  if (!err || typeof err !== 'object') return { ...Format.internalError(GENERIC_500), error: 'Internal server error' };

  // body-parser / raw-body (http-errors with a `type`)
  if (typeof err.type === 'string' && BODY_PARSER_MESSAGES[err.type]) {
    const status = err.type === 'entity.too.large' ? 413 : Number(err.status || err.statusCode) || 400;
    return Format.response(status, false, BODY_PARSER_MESSAGES[err.type]);
  }
  if ((err.status === 413 || err.statusCode === 413)) return Format.response(413, false, BODY_PARSER_MESSAGES['entity.too.large']);

  if (err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') return mapValidationError(err);

  if (err.name === 'CastError') {
    const message = `Invalid ${fieldLabel(err.path).toLowerCase()}`;
    return Format.badRequest(message, [{ field: err.path, message }]);
  }

  if (err.code === 11000 || err.code === 11001) return mapDuplicateKey(err);

  if (JWT_ERRORS[err.name]) {
    const { message, errorCode } = JWT_ERRORS[err.name];
    return { ...Format.unauthorized(message), errorCode };
  }

  // Other http-errors explicitly marked safe to expose (4xx): use the standard reason phrase.
  const status = Number(err.status || err.statusCode);
  if (err.expose === true && status >= 400 && status < 500) {
    return Format.response(status, false, http.STATUS_CODES[status] || 'Bad request');
  }

  return { ...Format.internalError(GENERIC_500), error: 'Internal server error' };
};

// Express error middleware (must keep 4 args).
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const body = mapError(err);
  const where = `${req.method} ${req.originalUrl ? req.originalUrl.split('?')[0] : ''}`;
  if (body.code >= 500) {
    // Full stack server-side only; never the request body (it may hold passwords/tokens).
    console.error(`[error] ${where}:`, err && err.stack ? err.stack : err);
  } else {
    console.warn(`[error] ${where} -> ${body.code} ${err && err.name ? err.name : 'Error'}: ${body.message}`);
  }
  return res.status(body.code).json(body);
};

module.exports = { errorHandler, mapError, fieldLabel };
