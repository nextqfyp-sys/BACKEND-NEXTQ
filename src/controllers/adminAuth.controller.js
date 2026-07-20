'use strict';

/**
 * Admin / Content-Moderator credential login.
 *
 * Unlike students (who authenticate via Phantom wallet + ed25519 signature),
 * admin and content_moderator accounts authenticate with username + password.
 *
 * The password is stored as a bcrypt hash in users.password_hash.
 * wallet_address is set to a synthetic value for these accounts so the
 * unique constraint is satisfied without a real Solana wallet.
 */

const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const { issueTokenPair, clearAuthCookies } = require('../utils/tokens');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

// ---------------------------------------------------------------------------
// POST /api/auth/admin-login
// ---------------------------------------------------------------------------
const adminLogin = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw AppError.badRequest('username and password are required');
  }

  // Find by username — only admin or content_moderator accounts have usernames
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !user.password_hash) {
    throw AppError.unauthorized('Invalid credentials');
  }

  if (user.role === 'student') {
    throw AppError.forbidden('Students must log in via Phantom wallet');
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);
  if (!passwordValid) {
    throw AppError.unauthorized('Invalid credentials');
  }

  await issueTokenPair(user.id, user.wallet_address, user.role, res);

  logger.info(`adminAuth: credential login username=${username} role=${user.role}`);

  res.json({
    user_id:     user.id,
    role:        user.role,
    username:    user.username,
    redirect_to: '/dashboard/admin',
    message:     'Logged in',
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/admin-create  (protected — only existing admins can call this)
// Used by the super-admin to create new admin/content_moderator accounts.
// ---------------------------------------------------------------------------
const adminCreate = asyncHandler(async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    throw AppError.badRequest('username and password are required');
  }

  const allowedRoles = ['admin', 'content_moderator'];
  const targetRole = role || 'content_moderator';
  if (!allowedRoles.includes(targetRole)) {
    throw AppError.badRequest(`role must be one of: ${allowedRoles.join(', ')}`);
  }

  // Check username not already taken
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw AppError.conflict('Username already taken');
  }

  const SALT_ROUNDS = 12;
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  // Synthetic wallet address — won't ever be used for Solana operations
  const syntheticWallet = `admin_${username}_${Date.now()}`;

  const user = await prisma.user.create({
    data: {
      wallet_address: syntheticWallet,
      username,
      password_hash,
      role:                targetRole,
      signup_bonus_granted: true, // no signup bonus for admin accounts
    },
  });

  // Ensure a balance row exists (balance stays 0 — admins don't use tokens)
  await prisma.balance.upsert({
    where:  { user_id: user.id },
    update: {},
    create: { user_id: user.id, token_balance: 0 },
  });

  logger.info(`adminAuth: created ${targetRole} account username=${username}`);

  res.status(201).json({
    user_id:  user.id,
    username: user.username,
    role:     user.role,
    message:  'Account created',
  });
});

module.exports = { adminLogin, adminCreate };
