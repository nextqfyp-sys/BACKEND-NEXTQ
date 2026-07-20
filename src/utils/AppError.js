'use strict';

class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} [code] - optional machine-readable code
   */
  constructor(message, statusCode = 500, code) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message)   { return new AppError(message, 400, 'BAD_REQUEST'); }
  static unauthorized(message) { return new AppError(message, 401, 'UNAUTHORIZED'); }
  static forbidden(message)    { return new AppError(message, 403, 'FORBIDDEN'); }
  static notFound(message)     { return new AppError(message, 404, 'NOT_FOUND'); }
  static internal(message)     { return new AppError(message || 'Internal server error', 500, 'INTERNAL'); }
}

module.exports = AppError;
