'use strict';

const { v4: uuidv4 } = require('uuid');
const { PaperModel } = require('../models/paper.model');
const { BalanceModel } = require('../models/user.model');
const { TransactionModel } = require('../models/transaction.model');
const aiService = require('../services/ai.service');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

const VERIFIED_COST   = 5; // 5 COIN for verified Cambridge/Boards paper
const UNVERIFIED_COST = 2; // 2 COIN for community paper

// ---------------------------------------------------------------------------
// POST /api/paper/generate  (verified — costs 5 COIN)
//
// Body: { subject, category, class_name, country, mcqs, short_questions,
//         long_questions, preference }
//
// 1. Balance check
// 2. Call FastAPI /verified/generate-paper/boards with structured params
// 3. Save paper row with the AI payload
// 4. Deduct COIN from DB
// ---------------------------------------------------------------------------
const generatePaper = asyncHandler(async (req, res) => {
  const {
    subject,
    category,
    class: class_name,
    country,
    mcqs,
    short_questions,
    long_questions,
    preference,
  } = req.body;

  if (!subject?.trim()) throw AppError.badRequest('subject is required');

  const balance = await BalanceModel.getBalance(req.userId);
  if (balance < VERIFIED_COST) {
    throw AppError.forbidden(
      `Insufficient COIN. You need ${VERIFIED_COST} COIN to generate a verified paper but have ${balance}.`
    );
  }

  // Call FastAPI with structured verified-paper params
  const paperPayload = await aiService.generateVerifiedPaper({
    subject:         subject.trim(),
    category:        category        ?? null,
    class_name:      class_name      ?? '',
    country:         country         ?? null,
    mcqs:            mcqs            ?? 10,
    short_questions: short_questions ?? 5,
    long_questions:  long_questions  ?? 3,
    preference:      preference      ?? null,
  });

  const downloadUrl = `/api/paper/download/${uuidv4()}`;
  const paper = await PaperModel.create(
    req.userId, subject.trim(), paperPayload, downloadUrl, VERIFIED_COST
  );

  await BalanceModel.setBalance(req.userId, balance - VERIFIED_COST);
  await TransactionModel.create(
    req.userId, null, VERIFIED_COST, 'paper_spend', paper.id,
    'Verified paper generation (5 COIN)'
  );

  logger.info(`paper: ${VERIFIED_COST} COIN deducted from user=${req.userId} subject="${subject.trim()}" category="${category}"`);
  res.status(201).json({ paper, solana_tx: null });
});

// ---------------------------------------------------------------------------
// POST /api/paper/generate-unverified  (community — costs 2 COIN)
//
// Body: { subject, category, class, country, mcqs, short_questions,
//         long_questions, preference }
// ---------------------------------------------------------------------------
const generateUnverifiedPaper = asyncHandler(async (req, res) => {
  const {
    subject,
    category,
    class: class_name,
    country,
    mcqs,
    short_questions,
    long_questions,
    preference,
  } = req.body;

  if (!subject?.trim()) throw AppError.badRequest('subject is required');

  const balance = await BalanceModel.getBalance(req.userId);
  if (balance < UNVERIFIED_COST) {
    throw AppError.forbidden(
      `Insufficient COIN. You need ${UNVERIFIED_COST} COIN to generate a community paper but have ${balance}.`
    );
  }

  // Call FastAPI with structured unverified-paper params
  const paperPayload = await aiService.generateUnverifiedPaper({
    subject:         subject.trim(),
    category:        category        ?? null,
    class_name:      class_name      ?? '',
    country:         country         ?? '',
    mcqs:            mcqs            ?? 10,
    short_questions: short_questions ?? 5,
    long_questions:  long_questions  ?? 3,
    preference:      preference      ?? null,
  });

  const downloadUrl = `/api/paper/download/${uuidv4()}`;
  const paper = await PaperModel.create(
    req.userId, subject.trim(), paperPayload, downloadUrl, UNVERIFIED_COST
  );

  await BalanceModel.setBalance(req.userId, balance - UNVERIFIED_COST);
  await TransactionModel.create(
    req.userId, null, UNVERIFIED_COST, 'unverified_paper_spend', paper.id,
    'Community paper generation (2 COIN)'
  );

  logger.info(`paper: ${UNVERIFIED_COST} COIN deducted from user=${req.userId} (community) category="${category}"`);
  res.status(201).json({ paper, solana_tx: null });
});

// ---------------------------------------------------------------------------
// POST /api/paper/record  (verified — after on-chain Phantom burn, no deduction)
// ---------------------------------------------------------------------------
const recordPaper = asyncHandler(async (req, res) => {
  const { subject, tokens_spent, paper_payload } = req.body;
  if (!subject?.trim()) throw AppError.badRequest('subject is required');
  if (!tokens_spent || tokens_spent <= 0) throw AppError.badRequest('tokens_spent must be > 0');

  const downloadUrl = `/api/paper/download/${uuidv4()}`;
  const paper = await PaperModel.create(
    req.userId, subject.trim(), paper_payload ?? null, downloadUrl, tokens_spent
  );
  logger.info(`paper: verified history row recorded user=${req.userId} (COIN burned on-chain)`);
  res.status(201).json({ paper, solana_tx: null });
});

// ---------------------------------------------------------------------------
// POST /api/paper/record-unverified  (community — after on-chain Phantom burn)
// ---------------------------------------------------------------------------
const recordUnverifiedPaper = asyncHandler(async (req, res) => {
  const { subject, tokens_spent, paper_payload } = req.body;
  if (!subject?.trim()) throw AppError.badRequest('subject is required');
  if (!tokens_spent || tokens_spent <= 0) throw AppError.badRequest('tokens_spent must be > 0');

  const downloadUrl = `/api/paper/download/${uuidv4()}`;
  const paper = await PaperModel.create(
    req.userId, subject.trim(), paper_payload ?? null, downloadUrl, tokens_spent
  );
  logger.info(`paper: unverified history row recorded user=${req.userId} (COIN burned on-chain)`);
  res.status(201).json({ paper, solana_tx: null });
});

// ---------------------------------------------------------------------------
// GET /api/paper/download/:paperId
// ---------------------------------------------------------------------------
const downloadPaper = asyncHandler(async (req, res) => {
  const paper = await PaperModel.findById(req.params.paperId);
  if (!paper) throw AppError.notFound('Paper not found');
  if (paper.user_id !== req.userId) throw AppError.forbidden('Access denied');

  res.json({
    id: paper.id,
    subject: paper.subject,
    download_url: paper.download_url,
    paper_payload: paper.paper_payload,
  });
});

// ---------------------------------------------------------------------------
// GET /api/paper/history
// ---------------------------------------------------------------------------
const paperHistory = asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit,  10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0,  0);
  const result = await PaperModel.historyByUser(req.userId, limit, offset);
  res.json(result);
});

module.exports = {
  generatePaper,
  generateUnverifiedPaper,
  recordPaper,
  recordUnverifiedPaper,
  downloadPaper,
  paperHistory,
};
