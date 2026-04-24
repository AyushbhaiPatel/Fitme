/**
 * Standardized response formatter
 */
class Format {
  static success(data = null, message = 'Success') {
    return { code: 200, success: true, message, data };
  }

  static created(data = null, message = 'Created successfully') {
    return { code: 201, success: true, message, data };
  }

  static badRequest(message = 'Bad request', errors = null) {
    const res = { code: 400, success: false, message };
    if (errors) res.errors = errors;
    return res;
  }

  static unauthorized(message = 'Unauthorized') {
    return { code: 401, success: false, message };
  }

  static notFound(message = 'Not found') {
    return { code: 404, success: false, message };
  }

  static conflict(message = 'Conflict') {
    return { code: 409, success: false, message };
  }

  static tooMany(message = 'Too many requests') {
    return { code: 429, success: false, message };
  }

  static internalError(message = 'Internal server error') {
    return { code: 500, success: false, message };
  }

  static response(code, success, message, data = null) {
    const res = { code, success, message };
    if (data !== null) res.data = data;
    return res;
  }
}

module.exports = { Format };
