'use strict';

const Redis = require('ioredis');
const logger = require('./logger');

let redisClient = null;
let redisStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
let lastError = null;

/**
 * Attempts to connect to Redis. This function NEVER throws — if Redis is
 * unavailable (not started yet, slow to boot, temporarily down, etc.) the
 * error is logged and the app is allowed to continue starting up so it can
 * serve traffic that doesn't depend on Redis. ioredis keeps retrying to
 * connect in the background per the configured retryStrategy, so Redis
 * becomes available automatically once it's up.
 */
async function connectRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisStatus = 'connecting';

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 10) return null; // stop retrying
      return Math.min(times * 200, 2000);
    },
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5000,
  });

  client.on('error', (err) => {
    lastError = err.message;
    redisStatus = 'error';
    logger.error('Redis error:', err.message);
  });
  client.on('ready', () => {
    redisStatus = 'connected';
    lastError = null;
    logger.info('Redis: connection established');
  });
  client.on('reconnecting', () => {
    redisStatus = 'connecting';
    logger.warn('Redis: reconnecting…');
  });
  client.on('close', () => {
    if (redisStatus !== 'error') redisStatus = 'disconnected';
  });
  client.on('end', () => {
    redisStatus = 'disconnected';
  });

  redisClient = client;

  try {
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error(`Unexpected Redis PING response: ${pong}`);
    redisStatus = 'connected';
    return redisClient;
  } catch (err) {
    lastError = err.message;
    redisStatus = 'error';
    logger.error(
      `Redis connection failed: ${err.message}\n` +
        `  → Make sure Redis is running: sudo service redis-server start (Linux/WSL)\n` +
        `  → Or: redis-server (Windows with Redis installed)\n` +
        `  → REDIS_URL=${url}\n` +
        `  → Continuing startup without Redis — rate limiting will be temporarily ` +
        `disabled until Redis becomes available. ioredis will keep retrying in the background.`
    );
    // Intentionally NOT rethrown — the app must keep starting. Keep the
    // client reference so ioredis can keep retrying in the background; once
    // it connects, isRedisAvailable() will start returning true automatically.
    return null;
  }
}

/**
 * Returns the raw ioredis client, or null if Redis has never connected.
 * Callers MUST check isRedisAvailable() (or handle a null/not-ready client)
 * before issuing commands — never assume Redis is ready.
 */
function getRedis() {
  return redisClient;
}

/** True only when the underlying ioredis client is actually ready to serve commands. */
function isRedisAvailable() {
  return !!redisClient && redisClient.status === 'ready';
}

/** Lightweight status object for health checks — never throws. */
function getRedisStatus() {
  return { status: isRedisAvailable() ? 'connected' : redisStatus, lastError };
}

module.exports = { connectRedis, getRedis, isRedisAvailable, getRedisStatus };
