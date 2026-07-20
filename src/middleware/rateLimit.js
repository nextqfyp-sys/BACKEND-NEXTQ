'use strict';

const { getRedis } = require('../config/redis');
const AppError = require('../utils/AppError');

/**
 * Enforce a daily limit using Redis INCR + EXPIRE.
 * @param {string} key   - e.g. "rl:quiz:<userId>"
 * @param {number} max   - max requests allowed
 * @param {number} ttl   - window in seconds (86400 = 1 day)
 */
async function enforceDailyLimit(key, max, ttl) {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttl);
  if (count > max) {
    const remaining = await redis.ttl(key);
    throw AppError.forbidden(
      `Daily limit of ${max} reached. Resets in ${Math.ceil(remaining / 3600)}h.`
    );
  }
}

/**
 * Enforce a per-request cooldown using Redis SET NX EX (atomic).
 * @param {string} key
 * @param {number} cooldownSeconds
 */
async function enforceCooldown(key, cooldownSeconds) {
  const redis = getRedis();
  // SET key 1 EX cooldown NX — only sets if key doesn't exist
  const result = await redis.set(key, '1', 'EX', cooldownSeconds, 'NX');
  if (result === null) {
    const ttl = await redis.ttl(key);
    throw AppError.forbidden(`Please wait ${ttl}s before trying again.`);
  }
}

// ── Express middleware factories ──────────────────────────────────────────

/**
 * Rate limit middleware factory.
 * @param {'quiz'|'paper'|'upload'|'send'|'buy'} resource
 * @param {number} maxPerDay
 * @param {number} [windowSeconds=86400]
 * @param {number} [cooldownSeconds=0]
 */
function dailyLimitMiddleware(resource, maxPerDay, windowSeconds = 86400, cooldownSeconds = 0) {
  return async (req, res, next) => {
    try {
      const userId = req.userId;
      await enforceDailyLimit(`rl:${resource}:${userId}`, maxPerDay, windowSeconds);
      if (cooldownSeconds > 0) {
        await enforceCooldown(`cd:${resource}:${userId}`, cooldownSeconds);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Pre-built middleware for each resource
const quizRateLimit = dailyLimitMiddleware(
  'quiz',
  parseInt(process.env.RATE_LIMIT_QUIZZES_PER_DAY, 10) || 20,
  86400,
  parseInt(process.env.QUIZ_COOLDOWN_SECONDS, 10) || 30
);

const paperRateLimit = dailyLimitMiddleware(
  'paper',
  parseInt(process.env.RATE_LIMIT_PAPERS_PER_DAY, 10) || 10
);

const uploadRateLimit = dailyLimitMiddleware(
  'upload',
  parseInt(process.env.RATE_LIMIT_UPLOADS_PER_DAY, 10) || 5
);

const sendRateLimit = dailyLimitMiddleware('send', 50);

const buyRateLimit = dailyLimitMiddleware('buy', 5, 3600); // hourly

module.exports = {
  enforceDailyLimit,
  enforceCooldown,
  quizRateLimit,
  paperRateLimit,
  uploadRateLimit,
  sendRateLimit,
  buyRateLimit,
};
