'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { getRedis } = require('../config/redis');
const AppError = require('./AppError');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

// Redis key prefixes
const ACCESS_WHITELIST_PREFIX = 'access:whitelist:';  // stores userId
const REFRESH_BLACKLIST_PREFIX = 'refresh:blacklist:'; // stores 1 when revoked

// Cookie names
const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

// ── Token generation ──────────────────────────────────────────────────────

/**
 * Issue an access token (15min) and store its jti in Redis whitelist.
 * @param {string} userId
 * @param {string} walletAddress
 * @param {string} role  — 'student' | 'admin' | 'content_moderator'
 */
async function issueAccessToken(userId, walletAddress, role) {
  const jti = crypto.randomUUID();

  const token = jwt.sign(
    { sub: userId, wallet: walletAddress, role, jti },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );

  // Whitelist in Redis — TTL matches token expiry (15min = 900s)
  const redis = getRedis();
  await redis.set(`${ACCESS_WHITELIST_PREFIX}${jti}`, userId, 'EX', 15 * 60);

  return token;
}

/**
 * Issue a refresh token (7 days), store its hash in DB and jti in Redis.
 */
async function issueRefreshToken(userId) {
  const jti = crypto.randomUUID();

  const token = jwt.sign({ sub: userId, jti }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });

  // Hash before storing in DB (never store raw tokens)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { user_id: userId, token_hash: tokenHash, expires_at: expiresAt },
  });

  return token;
}

/**
 * Issue both tokens and set httpOnly cookies on the response.
 * @param {string} userId
 * @param {string} walletAddress
 * @param {string} role
 * @param {import('express').Response} res
 */
async function issueTokenPair(userId, walletAddress, role, res) {
  const [accessToken, refreshToken] = await Promise.all([
    issueAccessToken(userId, walletAddress, role),
    issueRefreshToken(userId),
  ]);

  const isProd = process.env.NODE_ENV === 'production';

  // Access token cookie — 15 minutes
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000,
    path: '/',
  });

  // Refresh token cookie — 7 days
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth', // only sent to auth endpoints
  });

  return { accessToken, refreshToken };
}

// ── Token verification ────────────────────────────────────────────────────

/**
 * Verify an access token and check it's in the Redis whitelist.
 * @param {string} token
 * @returns {{ userId: string, wallet: string, jti: string }}
 */
async function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Access token expired');
    }
    throw AppError.unauthorized('Invalid access token');
  }

  // Check whitelist in Redis
  const redis = getRedis();
  const userId = await redis.get(`${ACCESS_WHITELIST_PREFIX}${payload.jti}`);
  if (!userId) {
    throw AppError.unauthorized('Access token has been revoked or is not whitelisted');
  }

  return { userId: payload.sub, wallet: payload.wallet, role: payload.role, jti: payload.jti };
}

/**
 * Verify a refresh token and check it's in the DB and not blacklisted.
 * @param {string} token
 * @returns {{ userId: string, jti: string, tokenHash: string }}
 */
async function verifyRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, REFRESH_TOKEN_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Refresh token expired — please log in again');
    }
    throw AppError.unauthorized('Invalid refresh token');
  }

  // Check Redis blacklist (revoked tokens)
  const redis = getRedis();
  const isBlacklisted = await redis.exists(`${REFRESH_BLACKLIST_PREFIX}${payload.jti}`);
  if (isBlacklisted) {
    throw AppError.unauthorized('Refresh token has been revoked');
  }

  // Check DB
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const stored = await prisma.refreshToken.findUnique({ where: { token_hash: tokenHash } });

  if (!stored || stored.revoked || stored.expires_at < new Date()) {
    throw AppError.unauthorized('Refresh token is invalid or expired');
  }

  return { userId: payload.sub, jti: payload.jti, tokenHash };
}

// ── Token revocation ──────────────────────────────────────────────────────

/**
 * Revoke an access token by removing it from the Redis whitelist.
 */
async function revokeAccessToken(jti) {
  const redis = getRedis();
  await redis.del(`${ACCESS_WHITELIST_PREFIX}${jti}`);
}

/**
 * Revoke a refresh token:
 *  1. Mark revoked in DB
 *  2. Add jti to Redis blacklist (TTL = 7 days)
 */
async function revokeRefreshToken(tokenHash, jti) {
  await prisma.refreshToken.updateMany({
    where: { token_hash: tokenHash },
    data: { revoked: true },
  });

  // Blacklist in Redis for the remaining TTL (7 days)
  const redis = getRedis();
  await redis.set(
    `${REFRESH_BLACKLIST_PREFIX}${jti}`,
    '1',
    'EX',
    7 * 24 * 60 * 60
  );
}

/**
 * Revoke all refresh tokens for a user (logout all devices).
 */
async function revokeAllUserRefreshTokens(userId) {
  await prisma.refreshToken.updateMany({
    where: { user_id: userId, revoked: false },
    data: { revoked: true },
  });
}

/**
 * Clear auth cookies from the response.
 */
function clearAuthCookies(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const opts = { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' };
  res.clearCookie(ACCESS_COOKIE, { ...opts, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: '/api/auth' });
}

module.exports = {
  issueTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  revokeAccessToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  clearAuthCookies,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
};
