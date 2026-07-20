'use strict';

const { PublicKey } = require('@solana/web3.js');
const {
  getLatestBlockhash,
  ensureRecipientAta,
  sendSignedTransaction,
  isSolanaConfigured,
  getConnection,
  getPlatformKeypair,
  getMintPubkey,
  RAW_PER_COIN,
} = require('../config/solana');
const { UserModel, BalanceModel } = require('../models/user.model');
const { TransactionModel } = require('../models/transaction.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

// GET /api/solana/blockhash
const getBlockhash = asyncHandler(async (req, res) => {
  if (!isSolanaConfigured()) {
    throw AppError.badRequest('Solana is not configured on this server');
  }
  const blockhash = await getLatestBlockhash();
  res.json({ blockhash });
});

// POST /api/solana/prepare-transfer
// Ensures recipient ATA exists (platform pays rent) and returns a fresh blockhash.
const prepareTransfer = asyncHandler(async (req, res) => {
  const { recipient_wallet } = req.body;
  if (!recipient_wallet) throw AppError.badRequest('recipient_wallet is required');

  if (!isSolanaConfigured()) {
    throw AppError.badRequest('Solana is not configured on this server');
  }

  // Validate public key format
  try { new PublicKey(recipient_wallet); } catch {
    throw AppError.badRequest('Invalid recipient wallet address');
  }

  const { ata, created, blockhash } = await ensureRecipientAta(recipient_wallet);

  res.json({ blockhash, recipient_ata: ata, ata_created: created });
});

// POST /api/token/submit-signed-tx
// Receives a Phantom-signed transaction, submits to RPC, updates DB.
const submitSignedTx = asyncHandler(async (req, res) => {
  const { signed_tx, tx_type, amount, purpose, recipient_wallet } = req.body;

  if (!signed_tx) throw AppError.badRequest('signed_tx is required');
  if (!tx_type) throw AppError.badRequest('tx_type is required (burn | transfer)');
  if (!amount || amount <= 0) throw AppError.badRequest('amount must be > 0');

  if (!isSolanaConfigured()) {
    throw AppError.badRequest('Solana is not configured on this server');
  }

  // Decode base64 tx
  let txBytes;
  try {
    txBytes = Buffer.from(signed_tx, 'base64');
  } catch {
    throw AppError.badRequest('Invalid base64 transaction');
  }

  // Deserialize the transaction to verify fee payer
  const { Transaction } = require('@solana/web3.js');
  let tx;
  try {
    tx = Transaction.from(txBytes);
  } catch {
    throw AppError.badRequest('Invalid transaction bytes');
  }

  // Verify transaction is signed
  if (!tx.signatures?.length || !tx.signatures[0]?.signature) {
    throw AppError.badRequest('Transaction is not signed');
  }

  // Verify fee payer matches the authenticated user's wallet
  const user = await UserModel.findById(req.userId);
  if (!user) throw AppError.notFound('User not found');

  const feePayer = tx.feePayer?.toBase58() || tx.instructions[0]?.keys[0]?.pubkey?.toBase58();
  if (feePayer && feePayer !== user.wallet_address) {
    throw AppError.forbidden('Transaction fee payer does not match your wallet');
  }

  // Check DB balance
  const currentBalance = await BalanceModel.getBalance(req.userId);
  if (currentBalance < amount) {
    throw AppError.forbidden(
      `Insufficient COIN. You have ${currentBalance} but need ${amount}.`
    );
  }

  // Submit to Solana RPC
  const sig = await sendSignedTransaction(txBytes);
  logger.info(`submit_signed_tx: ${tx_type} ${amount} COIN user=${req.userId} tx=${sig}`);

  let newBalance;

  if (tx_type === 'burn') {
    newBalance = currentBalance - amount;
    await BalanceModel.setBalance(req.userId, newBalance);
    await TransactionModel.create(
      req.userId, null, amount,
      purpose || 'spend', null,
      `On-chain burn tx: ${sig}`
    );
  } else if (tx_type === 'transfer') {
    newBalance = currentBalance - amount;
    await BalanceModel.setBalance(req.userId, newBalance);

    // Credit recipient in DB
    if (recipient_wallet) {
      const recipient = await UserModel.findByWallet(recipient_wallet);
      if (recipient) {
        const recipientBalance = await BalanceModel.getBalance(recipient.id);
        await BalanceModel.setBalance(recipient.id, recipientBalance + amount);
        await TransactionModel.create(
          req.userId, recipient.id, amount, 'send', null,
          `On-chain transfer tx: ${sig}`
        );
      } else {
        await TransactionModel.create(
          req.userId, null, amount, 'send', null,
          `On-chain transfer tx: ${sig}`
        );
      }
    }
  } else {
    throw AppError.badRequest(`Unknown tx_type: ${tx_type}`);
  }

  res.json({
    solana_tx: sig,
    new_balance: newBalance,
    note: `On-chain ${tx_type} of ${amount} COIN. Solana tx: ${sig}`,
    fee_charged: null,
  });
});

module.exports = { getBlockhash, prepareTransfer, submitSignedTx };
