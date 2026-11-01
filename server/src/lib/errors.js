'use strict';

/** 统一的业务错误：带 HTTP 状态码和机器可读 code，前端按 code 做文案/分支 */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message) => new ApiError(401, 'AUTH_REQUIRED', message);
const forbidden = (message) => new ApiError(403, 'FORBIDDEN', message);
const notFound = (message) => new ApiError(404, 'NOT_FOUND', message);
const conflict = (message) => new ApiError(409, 'CONFLICT', message);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict };
