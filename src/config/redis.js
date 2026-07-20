'use strict';

const Redis = require('ioredis');
const logger = require('./logger');

let redisClient = null;

async function connectRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 5) return null; // stop retrying
      return Math.min(times * 200, 2000);
    },
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5000,
  });

  redisClient.on('error', (err) => logger.error('Redis error:', err.message));
  redisClient.on('connect', () => logger.info('Redis: connection established'));
  redisClient.on('reconnecting', () => logger.warn('Redis: reconnecting…'));

  try {
    await redisClient.connect();
    const pong = await redisClient.ping();
    if (pong !== 'PONG') throw new Error(`Unexpected Redis PING response: ${pong}`);
    return redisClient;
  } catch (err) {
    throw new Error(
      `Redis connection failed: ${err.message}\n` +
      `  → Make sure Redis is running: sudo service redis-server start (Linux/WSL)\n` +
      `  → Or: redis-server (Windows with Redis installed)\n` +
      `  → REDIS_URL=${url}`
    );
  }
}

function getRedis() {
  if (!redisClient) throw new Error('Redis not initialised — call connectRedis() first');
  return redisClient;
}

module.exports = { connectRedis, getRedis };
