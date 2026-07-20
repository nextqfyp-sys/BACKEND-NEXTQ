'use strict';

const logger = require('../config/logger');
const AppError = require('../utils/AppError');

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

// eslint-disable-next-line no-unused-vars
function globalErrorHandler(err, req, res, next) {
  // Operational errors (AppError) — expected, safe to expose
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this value already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }

  // JWT errors (shouldn't reach here if authenticate middleware catches them)
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }

  // Unknown/programming errors — log the full stack
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFoundHandler, globalErrorHandler };
