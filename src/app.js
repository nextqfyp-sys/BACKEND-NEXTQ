'use strict';

// ── BigInt JSON serialization fix ─────────────────────────────────────────
// Prisma maps DB columns declared as BigInt (token_balance, tokens_spent,
// reward_tokens, amount) to native JS BigInt values.  JSON.stringify has no
// built-in BigInt handler and throws "Do not know how to serialize a BigInt".
// Patching toJSON here means every res.json() call across the entire app
// will automatically convert BigInt → Number, with no changes needed in
// individual controllers or models.
//
// Safe for this app: all COIN values fit comfortably in Number.MAX_SAFE_INTEGER
// (9_007_199_254_740_991), since the maximum balance is at most a few million COIN.
// eslint-disable-next-line no-extend-native
BigInt.prototype.toJSON = function () { return Number(this); };

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { corsOptions } = require('./config/cors');
const logger = require('./config/logger');
const { globalErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { getRedisStatus } = require('./config/redis');

// Route imports
const authRoutes = require('./routes/auth.routes');
const quizRoutes = require('./routes/quiz.routes');
const paperRoutes = require('./routes/paper.routes');
const uploadRoutes = require('./routes/upload.routes');
const tokenRoutes = require('./routes/token.routes');
const solanaRoutes = require('./routes/solana.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

// ── Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ── CORS (credentials: true so cookies are sent cross-origin) ─────────────
app.use(cors(corsOptions));

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Cookie parser (needed for httpOnly cookie auth) ───────────────────────
app.use(cookieParser());

// ── HTTP request logging ──────────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ── Health check (no auth — used by Railway/K8s probes) ───────────────────
// This reports the app as healthy as long as the process is up and serving
// requests — Redis availability is reported separately (see below) so that
// a slow/down Redis never causes the platform to think the whole app is
// unhealthy and restart it.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Detailed readiness check — reports each dependency independently ──────
// Redis status is informational only: `redis.status` can be "connected",
// "connecting", "disconnected" or "error" without affecting the overall
// HTTP status code, since the app can serve most traffic without Redis.
app.get('/health/ready', (_req, res) => {
  const redis = getRedisStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dependencies: {
      redis: {
        status: redis.status,
        available: redis.status === 'connected',
        ...(redis.lastError ? { lastError: redis.lastError } : {}),
      },
    },
  });
});

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/paper', paperRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/token', tokenRoutes);
app.use('/api/solana', solanaRoutes);
app.use('/api/admin', adminRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler ──────────────────────────────────────────────────
app.use(globalErrorHandler);

module.exports = app;
