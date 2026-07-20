'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

// Log slow queries in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    if (e.duration > 100) {
      logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
    }
  });
}

prisma.$on('error', (e) => logger.error('Prisma error:', e));
prisma.$on('warn', (e) => logger.warn('Prisma warning:', e));

async function connectPrisma() {
  await prisma.$connect();
}

async function disconnectPrisma() {
  await prisma.$disconnect();
}

module.exports = { prisma, connectPrisma, disconnectPrisma };
