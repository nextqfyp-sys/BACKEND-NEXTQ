'use strict';

require('dotenv').config();
const app = require('./app');
const { connectPrisma, disconnectPrisma } = require('./config/database');
const { connectRedis } = require('./config/redis');
const logger = require('./config/logger');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Connect PostgreSQL via Prisma (hard requirement — the app can't
    // function without a database, so a failure here should abort startup)
    await connectPrisma();
    logger.info('PostgreSQL connected via Prisma');

    // Connect Redis (optional, non-blocking). Redis is used for rate
    // limiting/caching only — it should never prevent the app from starting.
    // connectRedis() internally catches and logs connection errors instead
    // of throwing, but we still wrap it defensively here in case Redis is
    // slow to boot or briefly unavailable in a distributed environment
    // (e.g. services starting in parallel on Railway).
    connectRedis()
      .then(() => logger.info('Redis connected'))
      .catch((err) => {
        logger.error(
          `Redis connection failed on startup — continuing without Redis. ` +
            `Rate-limited/cache-dependent routes will degrade gracefully until it recovers. ${err.message}`
        );
      });

    const server = app.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        await disconnectPrisma();
        logger.info('Server shut down');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
