'use strict';

/**
 * Admin controller — all endpoints require requireAuth (admin access
 * is verified via the requireAdmin middleware on the router).
 *
 * GET  /api/admin/stats                  — dashboard KPIs + 7-day chart + recent activity
 * GET  /api/admin/users                  — paginated user list + optional search
 * GET  /api/admin/papers                 — paginated papers + per-subject breakdown
 * GET  /api/admin/papers/:id/payload     — fetch a single paper's payload (no ownership check)
 * GET  /api/admin/uploads                — paginated upload history
 * GET  /api/admin/transactions           — platform-wide transaction log
 * POST /api/admin/moderators             — create content_moderator account
 * DELETE /api/admin/moderators/:id       — delete content_moderator account
 * POST /api/admin/moderators/:id/reset-password — change moderator password
 */

const { prisma }     = require('../config/database');
const asyncHandler   = require('../utils/asyncHandler');
const logger         = require('../config/logger');
const AppError       = require('../utils/AppError');
const bcrypt         = require('bcryptjs');

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// ---------------------------------------------------------------------------
const getStats = asyncHandler(async (_req, res) => {
  const [
    totalUsers,
    totalQuizzes,
    totalPapers,
    totalUploads,
    dailySignups,
    recentUploads,
    recentTransactions,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.quiz.count(),
    prisma.paper.count(),
    prisma.upload.count(),

    // Daily signups for the last 7 days
    prisma.$queryRaw`
      SELECT
        DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') AS day,
        COUNT(*)::int AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1
      ORDER BY 1
    `,

    // 5 most recent uploads for the activity feed
    prisma.upload.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        filename: true,
        status: true,
        ai_score: true,
        reward_tokens: true,
        created_at: true,
        user: { select: { wallet_address: true } },
      },
    }),

    // 5 most recent transactions for the activity feed
    prisma.transaction.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        tx_type: true,
        amount: true,
        note: true,
        created_at: true,
        from_user: { select: { wallet_address: true } },
        to_user:   { select: { wallet_address: true } },
      },
    }),
  ]);

  // Fetch Solana token supply stats (best-effort — fails gracefully)
  let tokenSupply = null;
  try {
    const { getConnection, getMintPubkey, isSolanaConfigured } = require('../config/solana');
    if (isSolanaConfigured()) {
      const { getMint } = require('@solana/spl-token');
      const conn = getConnection();
      const mint = getMintPubkey();
      const mintInfo = await getMint(conn, mint);
      const RAW_PER_COIN = BigInt(100);
      const totalSupply   = Number(mintInfo.supply / RAW_PER_COIN);
      const maxSupply     = 1_000_000; // platform-defined cap
      tokenSupply = {
        total_supply:     maxSupply,
        minted_tokens:    totalSupply,
        remaining_tokens: Math.max(0, maxSupply - totalSupply),
      };
    }
  } catch (err) {
    logger.warn(`admin/stats: Solana supply fetch failed — ${err.message}`);
  }

  // Build a 7-element array (Sun … Sat labels with counts)
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const chart = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const label = dayLabels[d.getDay()];
    const iso = d.toISOString().slice(0, 10);
    const row = dailySignups.find(
      (r) => r.day.toISOString().slice(0, 10) === iso
    );
    return { day: label, count: row ? Number(row.count) : 0 };
  });

  // Merge uploads + transactions into a unified activity feed
  const activity = [
    ...recentUploads.map((u) => ({
      id:          `upload-${u.id}`,
      type:        'upload',
      title:       'Paper Uploaded',
      description: `${u.filename} — ${u.user?.wallet_address?.slice(0, 8) ?? 'unknown'}`,
      time:        u.created_at,
    })),
    ...recentTransactions.map((t) => ({
      id:          `tx-${t.id}`,
      type:        t.tx_type,
      title:       `COIN ${t.tx_type}`,
      description: t.note ?? `${t.amount} COIN`,
      time:        t.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 6);

  res.json({
    kpi: {
      total_users:   totalUsers,
      total_quizzes: totalQuizzes,
      total_papers:  totalPapers,
      total_uploads: totalUploads,
    },
    chart,
    activity,
    token_supply: tokenSupply,
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users?search=&role=&limit=20&offset=0
// ---------------------------------------------------------------------------
const getUsers = asyncHandler(async (req, res) => {
  const search     = req.query.search?.toString().trim() ?? '';
  const roleFilter = req.query.role?.toString().trim() ?? '';
  const limit      = Math.min(parseInt(req.query.limit,  10) || 20, 100);
  const offset     = Math.max(parseInt(req.query.offset, 10) || 0,  0);

  const where = {};

  if (search) {
    where.OR = [
      { wallet_address: { contains: search, mode: 'insensitive' } },
      { email:          { contains: search, mode: 'insensitive' } },
    ];
  }

  if (roleFilter) {
    where.role = roleFilter;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
      include: { balance: { select: { token_balance: true } } },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    users: users.map((u) => ({
      id:                   u.id,
      wallet_address:       u.wallet_address,
      email:                u.email,
      username:             u.username ?? null,
      role:                 u.role,
      signup_bonus_granted: u.signup_bonus_granted,
      token_balance:        Number(u.balance?.token_balance ?? 0),
      created_at:           u.created_at,
      updated_at:           u.updated_at,
    })),
    total,
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/papers?limit=20&offset=0
// ---------------------------------------------------------------------------
const getPapers = asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit,  10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0,  0);

  const [papers, total, bySubject] = await Promise.all([
    prisma.paper.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
      include: { user: { select: { wallet_address: true } } },
    }),
    prisma.paper.count(),
    prisma.$queryRaw`
      SELECT subject, COUNT(*)::int AS count
      FROM papers
      GROUP BY subject
      ORDER BY count DESC
      LIMIT 20
    `,
  ]);

  res.json({
    papers: papers.map((p) => ({
      id:           p.id,
      subject:      p.subject,
      tokens_spent: Number(p.tokens_spent),
      download_url: p.download_url,
      created_at:   p.created_at,
      wallet:       p.user?.wallet_address?.slice(0, 8) ?? 'unknown',
    })),
    total,
    limit,
    offset,
    by_subject: bySubject.map((r) => ({
      subject: r.subject,
      count:   Number(r.count),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/papers/:id/payload
// Fetch a single paper's payload — admin/moderator endpoint, no ownership check.
// ---------------------------------------------------------------------------
const getPaperPayload = asyncHandler(async (req, res) => {
  const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
  if (!paper) throw AppError.notFound('Paper not found');

  res.json({
    id:            paper.id,
    subject:       paper.subject,
    paper_payload: paper.paper_payload,
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/uploads?limit=20&offset=0
// ---------------------------------------------------------------------------
const getUploads = asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit,  10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0,  0);

  const [uploads, total, scored] = await Promise.all([
    prisma.upload.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
      include: { user: { select: { wallet_address: true } } },
    }),
    prisma.upload.count(),
    prisma.upload.count({ where: { status: 'scored' } }),
  ]);

  res.json({
    uploads: uploads.map((u) => ({
      id:            u.id,
      filename:      u.filename,
      storage_path:  u.storage_path,
      status:        u.status,
      ai_score:      u.ai_score !== null ? Number(u.ai_score) : null,
      reward_tokens: Number(u.reward_tokens),
      created_at:    u.created_at,
      updated_at:    u.updated_at,
      wallet:        u.user?.wallet_address?.slice(0, 8) ?? 'unknown',
    })),
    total,
    scored,
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/transactions?limit=20&offset=0
// ---------------------------------------------------------------------------
const getTransactions = asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit,  10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0,  0);

  const [txs, total] = await Promise.all([
    prisma.transaction.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
      include: {
        from_user: { select: { wallet_address: true } },
        to_user:   { select: { wallet_address: true } },
      },
    }),
    prisma.transaction.count(),
  ]);

  res.json({
    transactions: txs.map((t) => ({
      id:          t.id,
      tx_type:     t.tx_type,
      amount:      Number(t.amount),
      note:        t.note,
      created_at:  t.created_at,
      from_wallet: t.from_user?.wallet_address?.slice(0, 8) ?? null,
      to_wallet:   t.to_user?.wallet_address?.slice(0, 8)   ?? null,
    })),
    total,
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/moderators
// Create a brand-new content_moderator account with username + password.
// No Phantom wallet required — these accounts log in via /api/auth/admin-login.
// ---------------------------------------------------------------------------
const createModerator = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username?.trim()) throw AppError.badRequest('username is required');
  if (!password || password.length < 8) throw AppError.badRequest('password must be at least 8 characters');

  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) throw AppError.conflict('Username already taken');

  const SALT_ROUNDS = 12;
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      wallet_address:       null,
      username:             username.trim(),
      password_hash,
      role:                 'content_moderator',
      signup_bonus_granted: true,
    },
  });

  await prisma.balance.upsert({
    where:  { user_id: user.id },
    update: {},
    create: { user_id: user.id, token_balance: 0 },
  });

  logger.info(`admin: created content_moderator username=${username.trim()} id=${user.id}`);

  res.status(201).json({
    id:         user.id,
    username:   user.username,
    role:       user.role,
    created_at: user.created_at,
    updated_at: user.updated_at,
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/moderators/:id
// ---------------------------------------------------------------------------
const deleteModerator = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.notFound('User not found');
  if (user.role !== 'content_moderator') {
    throw AppError.badRequest('Only content_moderator accounts can be deleted from this endpoint');
  }

  await prisma.user.delete({ where: { id } });

  logger.info(`admin: deleted content_moderator id=${id}`);
  res.json({ message: 'Content moderator account deleted' });
});

// ---------------------------------------------------------------------------
// POST /api/admin/moderators/:id/reset-password
// ---------------------------------------------------------------------------
const resetModeratorPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;

  if (!new_password || new_password.length < 8) {
    throw AppError.badRequest('new_password must be at least 8 characters');
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.notFound('User not found');
  if (user.role !== 'content_moderator') {
    throw AppError.badRequest('Only content_moderator accounts support password reset');
  }

  const SALT_ROUNDS = 12;
  const password_hash = await bcrypt.hash(new_password, SALT_ROUNDS);

  await prisma.user.update({ where: { id }, data: { password_hash } });

  logger.info(`admin: reset password for content_moderator id=${id}`);
  res.json({ message: 'Password updated successfully' });
});

module.exports = {
  getStats,
  getUsers,
  getPapers,
  getPaperPayload,
  getUploads,
  getTransactions,
  createModerator,
  deleteModerator,
  resetModeratorPassword,
};
