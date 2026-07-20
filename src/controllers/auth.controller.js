'use strict';

const { UserModel, BalanceModel } = require('../models/user.model');
const { TransactionModel } = require('../models/transaction.model');
const { verifyPhantomSignature } = require('../utils/verifyPhantomSignature');
const {
  issueTokenPair,
  verifyRefreshToken,
  revokeAccessToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  clearAuthCookies,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} = require('../utils/tokens');
const { mintTokensToUser, isSolanaConfigured } = require('../config/solana');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

// The admin wallet address is set via env var.
// Any user who signs up/logs in with this wallet receives the 'admin' role.
const ADMIN_WALLET = (process.env.ADMIN_WALLET || '').trim();

/**
 * Determine a user's role.
 * - If the wallet matches ADMIN_WALLET → 'admin'
 * - Otherwise → 'student' (new users) or keep existing role (returning users)
 */
function resolveRole(walletAddress, existingRole = null) {
  if (ADMIN_WALLET && walletAddress === ADMIN_WALLET) return 'admin';
  return existingRole ?? 'student';
}

/** Returns the dashboard path for a given role */
function dashboardFor(role) {
  if (role === 'admin' || role === 'content_moderator') return '/dashboard/admin';
  return '/dashboard/student';
}

// ---------------------------------------------------------------------------
// POST /api/auth/signup
// ---------------------------------------------------------------------------
const signup = asyncHandler(async (req, res) => {
  const { wallet_address, signed_message, signature, email } = req.body;

  if (!wallet_address || !signed_message || !signature) {
    throw AppError.badRequest('wallet_address, signed_message, and signature are required');
  }

  // 1. Verify Phantom ed25519 signature
  const isValid = verifyPhantomSignature(wallet_address, signed_message, signature);
  if (!isValid) throw AppError.unauthorized('Wallet signature verification failed');

  // 2. Validate nonce freshness (reject if older than 5 minutes)
  const nonceMatch = signed_message.match(/Nonce:\s*(\d+)/);
  if (!nonceMatch) throw AppError.badRequest('Invalid message format — missing nonce');
  if (Date.now() - parseInt(nonceMatch[1], 10) > 5 * 60 * 1000) {
    throw AppError.unauthorized('Message nonce has expired — please try again');
  }

  // 3. Find or create user with correct role
  let user = await UserModel.findByWallet(wallet_address);
  let isNew = false;
  const role = resolveRole(wallet_address, user?.role ?? null);

  if (!user) {
    user = await UserModel.create(wallet_address, email || null, role);
    await BalanceModel.createIfMissing(user.id);
    isNew = true;
    logger.info(`auth: new user created wallet=${wallet_address.slice(0, 8)} role=${role}`);
  } else {
    // Returning user — upgrade to admin if wallet matches (e.g. env var was added later)
    if (role !== user.role) {
      user = await UserModel.updateRole(user.id, role);
      logger.info(`auth: role updated wallet=${wallet_address.slice(0, 8)} role=${role}`);
    }
    // Update email if provided and not already set
    if (email && !user.email) {
      user = await UserModel.updateEmail(user.id, email);
    }
  }

  // 4. Grant 20 COIN signup bonus (once per wallet)
  let solanaTx = null;
  if (!user.signup_bonus_granted) {
    if (isSolanaConfigured()) {
      try {
        solanaTx = await mintTokensToUser(wallet_address, BigInt(2000));
        logger.info(`auth: signup bonus minted on-chain tx=${solanaTx}`);
      } catch (err) {
        logger.warn(`auth: on-chain mint failed — DB-only fallback: ${err.message}`);
      }
    }

    const currentBalance = await BalanceModel.getBalance(user.id);
    await BalanceModel.setBalance(user.id, currentBalance + 20);
    await UserModel.markSignupBonusGranted(user.id);
    await TransactionModel.create(
      null, user.id, 20, 'signup_bonus', null,
      solanaTx ? `On-chain mint tx: ${solanaTx}` : 'DB-only — Solana not configured'
    );
  }

  // 5. Issue access + refresh tokens (role is embedded in the JWT)
  await issueTokenPair(user.id, user.wallet_address, user.role, res);

  res.status(isNew ? 201 : 200).json({
    user_id:       user.id,
    role:          user.role,
    redirect_to:   dashboardFor(user.role),
    solana_tx:     solanaTx,
    message:       isNew ? 'Account created' : 'Logged in',
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
const login = asyncHandler(async (req, res) => {
  const { wallet_address, signed_message, signature } = req.body;

  if (!wallet_address || !signed_message || !signature) {
    throw AppError.badRequest('wallet_address, signed_message, and signature are required');
  }

  const isValid = verifyPhantomSignature(wallet_address, signed_message, signature);
  if (!isValid) throw AppError.unauthorized('Wallet signature verification failed');

  const nonceMatch = signed_message.match(/Nonce:\s*(\d+)/);
  if (!nonceMatch) throw AppError.badRequest('Invalid message format — missing nonce');
  if (Date.now() - parseInt(nonceMatch[1], 10) > 5 * 60 * 1000) {
    throw AppError.unauthorized('Message nonce has expired');
  }

  let user = await UserModel.findByWallet(wallet_address);
  if (!user) throw AppError.notFound('Wallet not registered — please sign up first');

  // Auto-promote to admin if wallet matches ADMIN_WALLET (handles env var added after first signup)
  const role = resolveRole(wallet_address, user.role);
  if (role !== user.role) {
    user = await UserModel.updateRole(user.id, role);
    logger.info(`auth: role updated on login wallet=${wallet_address.slice(0, 8)} role=${role}`);
  }

  await issueTokenPair(user.id, user.wallet_address, user.role, res);

  res.json({
    user_id:     user.id,
    role:        user.role,
    redirect_to: dashboardFor(user.role),
    message:     'Logged in',
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) throw AppError.unauthorized('No refresh token cookie');

  const { userId, jti, tokenHash } = await verifyRefreshToken(refreshToken);

  await revokeRefreshToken(tokenHash, jti);

  const user = await UserModel.findById(userId);
  if (!user) throw AppError.unauthorized('User no longer exists');

  await issueTokenPair(user.id, user.wallet_address, user.role, res);

  res.json({ message: 'Tokens refreshed' });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  const accessToken  = req.cookies?.[ACCESS_COOKIE];

  if (accessToken) {
    try {
      const jwt = require('jsonwebtoken');
      const payload = jwt.decode(accessToken);
      if (payload?.jti) await revokeAccessToken(payload.jti);
    } catch { /* ignore */ }
  }

  if (refreshToken) {
    try {
      const { jti, tokenHash } = await verifyRefreshToken(refreshToken);
      await revokeRefreshToken(tokenHash, jti);
    } catch { /* ignore — may already be expired */ }
  }

  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout-all
// ---------------------------------------------------------------------------
const logoutAll = asyncHandler(async (req, res) => {
  await revokeAllUserRefreshTokens(req.userId);
  clearAuthCookies(res);
  res.json({ message: 'Logged out from all devices' });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
const me = asyncHandler(async (req, res) => {
  const user = await UserModel.findById(req.userId);
  if (!user) throw AppError.notFound('User not found');

  const balance = await BalanceModel.getBalance(req.userId);

  // Omit sensitive fields before sending to client
  const { password_hash, ...safeUser } = user;

  res.json({ user: safeUser, balance });
});

module.exports = { signup, login, refresh, logout, logoutAll, me };
