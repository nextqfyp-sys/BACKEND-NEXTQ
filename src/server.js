'use strict';

require('dotenv').config();
const app = require('./app');
const { connectPrisma, disconnectPrisma } = require('./config/database');
const { connectRedis } = require('./config/redis');
const logger = require('./config/logger');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Connect PostgreSQL via Prisma
    await connectPrisma();
    logger.info('PostgreSQL connected via Prisma');

    // Connect Redis (required)
    await connectRedis();
    logger.info('Redis connected');

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
