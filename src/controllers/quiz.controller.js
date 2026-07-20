'use strict';

const { QuizModel } = require('../models/quiz.model');
const { BalanceModel } = require('../models/user.model');
const { TransactionModel } = require('../models/transaction.model');
const aiService = require('../services/ai.service');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

const QUIZ_COST = 5;

// ---------------------------------------------------------------------------
// POST /api/quiz/generate  (DB-only fallback — Phantom unavailable)
//
// Body: { subject, category, class, country, number_of_mcqs, preference }
//
// 1. Check balance (fail fast — don't waste AI call if broke)
// 2. Call FastAPI /verified/generate-quiz with structured params
// 3. Create quiz row in DB with the AI questions
// 4. Deduct COIN from DB
// ---------------------------------------------------------------------------
const generateQuiz = asyncHandler(async (req, res) => {
  const {
    subject,
    category,
    class: class_name,
    country,
    number_of_mcqs,
    preference,
  } = req.body;

  if (!subject?.trim()) throw AppError.badRequest('subject is required');

  // 1. Balance check
  const balance = await BalanceModel.getBalance(req.userId);
  if (balance < QUIZ_COST) {
    throw AppError.forbidden(
      `Insufficient COIN. You need ${QUIZ_COST} COIN to generate a quiz but have ${balance}.`
    );
  }

  // 2. Generate questions via FastAPI with structured params
  const { mcqs } = await aiService.generateVerifiedQuiz({
    subject:        subject.trim(),
    category:       category       ?? null,
    class_name:     class_name     ?? null,
    country:        country        ?? null,
    number_of_mcqs: number_of_mcqs ?? 10,
    preference:     preference     ?? null,
  });

  // Normalise: service returns { mcqs } but QuizModel expects questions array
  const questions = mcqs ?? [];

  // 3. Save quiz row with the AI-generated questions
  const quiz = await QuizModel.create(req.userId, subject.trim(), questions, QUIZ_COST);

  // 4. Deduct COIN from DB
  await BalanceModel.setBalance(req.userId, balance - QUIZ_COST);
  await TransactionModel.create(
    req.userId, null, QUIZ_COST, 'quiz_spend', quiz.id,
    'Verified quiz generation (5 COIN)'
  );

  logger.info(`quiz: ${QUIZ_COST} COIN deducted from user=${req.userId} subject="${subject.trim()}" category="${category}"`);
  res.status(201).json({ quiz, solana_tx: null });
});

// ---------------------------------------------------------------------------
// POST /api/quiz/record  (after on-chain Phantom burn — no balance deduction)
//
// Called after a successful client-side Phantom burn. Records the quiz row
// in DB for history — COIN already burned on-chain so no deduction here.
// ---------------------------------------------------------------------------
const recordQuiz = asyncHandler(async (req, res) => {
  const { subject, tokens_spent } = req.body;
  if (!subject?.trim()) throw AppError.badRequest('subject is required');
  if (!tokens_spent || tokens_spent <= 0) throw AppError.badRequest('tokens_spent must be > 0');

  // Insert with empty questions — on-chain path doesn't need server-side AI here
  // (the frontend may have already shown questions from a prior generate call)
  const quiz = await QuizModel.create(req.userId, subject.trim(), [], tokens_spent);
  logger.info(`quiz: history row recorded user=${req.userId} (COIN burned on-chain)`);
  res.status(201).json({ quiz, solana_tx: null });
});

// ---------------------------------------------------------------------------
// POST /api/quiz/submit
// ---------------------------------------------------------------------------
const submitQuiz = asyncHandler(async (req, res) => {
  const { quiz_id, answers, score } = req.body;
  if (!quiz_id) throw AppError.badRequest('quiz_id is required');
  if (score === undefined || score < 0 || score > 100) {
    throw AppError.badRequest('score must be between 0 and 100');
  }

  const existing = await QuizModel.findById(quiz_id);
  if (!existing) throw AppError.notFound('Quiz not found');
  if (existing.user_id !== req.userId) throw AppError.forbidden('Access denied');

  const quiz = await QuizModel.submitAnswers(quiz_id, answers, score);
  res.json(quiz);
});

// ---------------------------------------------------------------------------
// GET /api/quiz/history
// ---------------------------------------------------------------------------
const quizHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const result = await QuizModel.historyByUser(req.userId, limit, offset);
  res.json(result);
});

// ---------------------------------------------------------------------------
// PATCH /api/quiz/:id/questions  (update questions after on-chain Phantom path)
//
// Called after AI questions are fetched on the client side (Phantom path).
// Updates the quiz row's questions field so history can display them.
// ---------------------------------------------------------------------------
const updateQuizQuestions = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { questions } = req.body;

  if (!id) throw AppError.badRequest('quiz id is required');
  if (!Array.isArray(questions)) throw AppError.badRequest('questions must be an array');

  const existing = await QuizModel.findById(id);
  if (!existing) throw AppError.notFound('Quiz not found');
  if (existing.user_id !== req.userId) throw AppError.forbidden('Access denied');

  const quiz = await QuizModel.updateQuestions(id, questions);
  res.json(quiz);
});

module.exports = { generateQuiz, recordQuiz, submitQuiz, quizHistory, updateQuizQuestions };
