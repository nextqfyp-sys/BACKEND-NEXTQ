'use strict';

/**
 * Upload controller
 *
 * Flow for POST /api/upload/submit:
 *   1. Receive multipart/form-data (PDF or image, max 10 MB)
 *   2. Send the file buffer to the FastAPI AI scoring endpoint
 *   3. If ai_score > 0  → upload to Cloudinary, store public_id + secure_url
 *      If ai_score == 0 → skip Cloudinary entirely (no charge, no storage waste)
 *   4. Save upload row in DB with status, score, reward_tokens
 *   5. If reward_tokens > 0 → credit COIN (on-chain mint + DB)
 */

const { UploadModel } = require('../models/upload.model');
const { UserModel, BalanceModel } = require('../models/user.model');
const { TransactionModel } = require('../models/transaction.model');
const { uploadToCloudinary } = require('../config/cloudinary');
const { mintTokensToUser, isSolanaConfigured, RAW_PER_COIN } = require('../config/solana');
const aiService = require('../services/ai.service');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

// ---------------------------------------------------------------------------
// POST /api/upload/submit
// ---------------------------------------------------------------------------
const submitUpload = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('No file uploaded');

  const { originalname, buffer, mimetype } = req.file;

  // Optional metadata from the form body (used when student uploads from the upload page)
  const country  = req.body.country  ?? '';
  const className = req.body.class   ?? '';
  const subject  = req.body.subject  ?? '';
  const category = req.body.category ?? '';

  // ── Step 1: Score the upload via FastAPI AI ───────────────────────────────
  // Pass the file buffer + metadata so the AI can extract questions correctly.
  const { accepted, ai_score, reward_tokens } = await aiService.scoreUpload(
    buffer, originalname, country, className, subject, category
  );

  // ── Step 2: Conditional Cloudinary upload ────────────────────────────────
  // Only persist files that pass the AI quality bar (score > 0).
  // Zero-score uploads are still recorded in DB for audit purposes,
  // but we don't waste Cloudinary storage quota on them.
  let publicId   = `local/${Date.now()}-${originalname}`;
  let secureUrl  = null;
  let storedInCloudinary = false;

  if (ai_score > 0) {    try {
      const cloudResult = await uploadToCloudinary(buffer, originalname, mimetype);
      publicId  = cloudResult.publicId;
      secureUrl = cloudResult.secureUrl;
      storedInCloudinary = true;
      logger.info(
        `upload: stored in Cloudinary public_id="${publicId}" url="${secureUrl}"`
      );
    } catch (err) {
      // Cloudinary failure must not block the whole request.
      // Log the error, proceed with a DB-only record.
      logger.error(`upload: Cloudinary upload failed — proceeding DB-only: ${err.message}`);
    }
  } else {
    logger.info(
      `upload: ai_score=0 for "${originalname}" — skipping Cloudinary storage`
    );
  }

  // ── Step 3: Save upload record in DB ─────────────────────────────────────
  const upload = await UploadModel.create(req.userId, originalname, publicId);
  const scored = await UploadModel.updateScoring(upload.id, 'scored', ai_score, reward_tokens);

  // ── Step 4: Credit COIN if reward > 0 ────────────────────────────────────
  let solanaTx = null;
  if (reward_tokens > 0) {
    const currentBalance = await BalanceModel.getBalance(req.userId);

    // Try on-chain mint (non-blocking — DB always gets credited)
    if (isSolanaConfigured()) {
      try {
        const user = await UserModel.findById(req.userId);
        const rawAmount = BigInt(reward_tokens) * RAW_PER_COIN;
        solanaTx = await mintTokensToUser(user.wallet_address, rawAmount);
        logger.info(
          `upload: minted ${reward_tokens} COIN on-chain tx=${solanaTx} user=${req.userId}`
        );
      } catch (err) {
        logger.error(`upload: on-chain mint failed — DB-only fallback: ${err.message}`);
      }
    }

    await BalanceModel.setBalance(req.userId, currentBalance + reward_tokens);

    const note = solanaTx
      ? `Upload reward ${reward_tokens} COIN (score=${ai_score.toFixed(2)}) tx=${solanaTx}`
      : `Upload reward ${reward_tokens} COIN (score=${ai_score.toFixed(2)}) — DB-only`;

    await TransactionModel.create(
      null, req.userId, reward_tokens, 'upload_reward', upload.id, note
    );

    logger.info(
      `upload: ${reward_tokens} COIN rewarded to user=${req.userId} (score=${ai_score.toFixed(2)})`
    );
  } else {
    logger.info(
      `upload: no reward for user=${req.userId} (score=${ai_score.toFixed(2)} → 0 COIN)`
    );
  }

  // ── Step 5: Respond ───────────────────────────────────────────────────────
  res.status(201).json({
    ...scored,
    cloudinary_url: secureUrl,               // null if not stored (score == 0 or upload failed)
    stored_in_cloudinary: storedInCloudinary,
    solana_tx: solanaTx,
  });
});

// ---------------------------------------------------------------------------
// GET /api/upload/status/:uploadId
// ---------------------------------------------------------------------------
const uploadStatus = asyncHandler(async (req, res) => {
  const upload = await UploadModel.findById(req.params.uploadId);
  if (!upload) throw AppError.notFound('Upload not found');
  if (upload.user_id !== req.userId) throw AppError.forbidden('Access denied');
  res.json(upload);
});

// ---------------------------------------------------------------------------
// GET /api/upload/history
// ---------------------------------------------------------------------------
const uploadHistory = asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit,  10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0,  0);
  const uploads = await UploadModel.historyByUser(req.userId, limit, offset);
  res.json(uploads);
});

module.exports = { submitUpload, uploadStatus, uploadHistory };
