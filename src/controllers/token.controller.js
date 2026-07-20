'use strict';

const { UserModel, BalanceModel } = require('../models/user.model');
const { TransactionModel, TokenTransferModel } = require('../models/transaction.model');
const { mintTokensToUser, getOnChainCoinBalance, isSolanaConfigured, RAW_PER_COIN } = require('../config/solana');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

// GET /api/token/balance
// Syncs DB upward if on-chain > DB (on-chain authoritative for credits)
const getBalance = asyncHandler(async (req, res) => {
  if (isSolanaConfigured()) {
    try {
      const user = await UserModel.findById(req.userId);
      const onChainBalance = Number(await getOnChainCoinBalance(user.wallet_address));
      const dbBalance = await BalanceModel.getBalance(req.userId);

      if (onChainBalance > dbBalance) {
        logger.info(
          `balance sync UP: user=${req.userId} on_chain=${onChainBalance} db=${dbBalance}`
        );
        await BalanceModel.setBalance(req.userId, onChainBalance);
        return res.json({ balance: onChainBalance });
      }

      return res.json({ balance: dbBalance });
    } catch (err) {
      logger.warn(`balance: on-chain read failed — using DB: ${err.message}`);
    }
  }

  const balance = await BalanceModel.getBalance(req.userId);
  res.json({ balance });
});

// POST /api/token/send  (custodial — server mints to recipient)
const sendTokens = asyncHandler(async (req, res) => {
  const { recipient_wallet, amount } = req.body;

  if (!recipient_wallet) throw AppError.badRequest('recipient_wallet is required');
  if (!amount || amount <= 0) throw AppError.badRequest('amount must be > 0');

  const recipient = await UserModel.findByWallet(recipient_wallet);
  if (!recipient) {
    throw AppError.notFound('Recipient wallet is not registered on this platform');
  }
  if (recipient.id === req.userId) {
    throw AppError.badRequest('Cannot send COIN to yourself');
  }

  const senderBalance = await BalanceModel.getBalance(req.userId);
  if (senderBalance < amount) {
    throw AppError.forbidden(
      `Insufficient COIN. You have ${senderBalance} COIN but need ${amount}.`
    );
  }

  // On-chain: mint to recipient (server is mint authority)
  let solanaTx = null;
  let onChainStatus = 'DB-only (Solana not configured)';

  if (isSolanaConfigured()) {
    try {
      const rawAmount = BigInt(amount) * RAW_PER_COIN;
      solanaTx = await mintTokensToUser(recipient_wallet, rawAmount);
      onChainStatus = `On-chain mint tx: ${solanaTx}`;
      logger.info(`token_send: minted ${amount} COIN to ${recipient_wallet} tx=${solanaTx}`);
    } catch (err) {
      logger.error(`token_send: on-chain mint failed — DB-only: ${err.message}`);
      onChainStatus = `On-chain failed (${err.message}), DB updated`;
    }
  }

  // DB: deduct from sender, credit recipient
  const recipientBalance = await BalanceModel.getBalance(recipient.id);
  await BalanceModel.setBalance(req.userId, senderBalance - amount);
  await BalanceModel.setBalance(recipient.id, recipientBalance + amount);

  const tx = await TransactionModel.create(
    req.userId, recipient.id, amount, 'send', null, onChainStatus
  );
  const transfer = await TokenTransferModel.create(req.userId, recipient.id, amount, tx.id);

  res.json({
    transfer,
    fee_charged: 0,
    solana_tx: solanaTx,
    on_chain_status: onChainStatus,
  });
});

// GET /api/token/history
const tokenHistory = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = parseInt(req.query.offset, 10) || 0;

  const [transactions, sends_and_receives] = await Promise.all([
    TransactionModel.historyByUser(req.userId, limit, offset),
    TokenTransferModel.historyByUser(req.userId, limit, offset),
  ]);

  res.json({ transactions, sends_and_receives });
});

// POST /api/token/buy  (PayPal placeholder)
const buyTokens = asyncHandler(async (req, res) => {
  const { usd_amount } = req.body;
  if (!usd_amount || usd_amount <= 0) throw AppError.badRequest('usd_amount must be > 0');

  const tokens = usd_amount * 5; // 5 COIN per $1
  const user = await UserModel.findById(req.userId);
  if (!user) throw AppError.notFound('User not found');

  let solanaTx = null;
  if (isSolanaConfigured()) {
    try {
      const rawAmount = BigInt(tokens) * RAW_PER_COIN;
      solanaTx = await mintTokensToUser(user.wallet_address, rawAmount);
      logger.info(`token_buy: minted ${tokens} COIN tx=${solanaTx}`);
    } catch (err) {
      logger.error(`token_buy: on-chain mint failed — DB-only: ${err.message}`);
    }
  }

  const currentBalance = await BalanceModel.getBalance(req.userId);
  await BalanceModel.setBalance(req.userId, currentBalance + tokens);

  const note = solanaTx
    ? `PayPal placeholder + on-chain mint tx: ${solanaTx}`
    : 'PayPal placeholder credit (DB-only)';

  await TransactionModel.create(null, req.userId, tokens, 'buy', null, note);

  res.json({
    checkout_url: `https://www.sandbox.paypal.com/checkoutnow?user=${req.userId}`,
    credited_tokens: tokens,
    note,
    solana_tx: solanaTx,
  });
});

module.exports = { getBalance, sendTokens, tokenHistory, buyTokens };
