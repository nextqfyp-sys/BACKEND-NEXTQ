'use strict';

const { verifyAccessToken, ACCESS_COOKIE } = require('../utils/tokens');
const AppError = require('../utils/AppError');

/**
 * requireAuth — verifies the httpOnly access_token cookie, checks the Redis
 * whitelist, and attaches req.userId, req.walletAddress, and req.userRole.
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) {
      return next(AppError.unauthorized('Not authenticated — no access token cookie'));
    }

    const { userId, wallet, role } = await verifyAccessToken(token);
    req.userId      = userId;
    req.walletAddress = wallet;
    req.userRole    = role ?? 'student';
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * requireAdmin — must be used AFTER requireAuth.
 * Blocks non-admin users from accessing admin-only routes.
 */
function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return next(AppError.forbidden('Admin access required'));
  }
  next();
}

/**
 * requireRole(...roles) — generic role guard factory.
 * Usage: router.get('/route', requireAuth, requireRole('admin', 'content_moderator'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return next(AppError.forbidden(`Access requires one of: ${roles.join(', ')}`));
    }
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requireRole };
