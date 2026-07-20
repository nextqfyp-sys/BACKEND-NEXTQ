'use strict';

const { prisma } = require('../config/database');

const TransactionModel = {
  async create(fromUserId, toUserId, amount, txType, referenceId = null, note = null) {
    return prisma.transaction.create({
      data: {
        from_user_id: fromUserId || undefined,
        to_user_id: toUserId || undefined,
        amount,
        tx_type: txType,
        reference_id: referenceId || undefined,
        note: note || undefined,
      },
    });
  },

  async historyByUser(userId, limit = 20, offset = 0) {
    return prisma.transaction.findMany({
      where: {
        OR: [{ from_user_id: userId }, { to_user_id: userId }],
      },
      orderBy: { created_at: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });
  },
};

const TokenTransferModel = {
  async create(senderUserId, recipientUserId, amount, transactionId = null) {
    return prisma.tokenTransfer.create({
      data: {
        sender_user_id: senderUserId,
        recipient_user_id: recipientUserId,
        amount,
        transaction_id: transactionId || undefined,
      },
    });
  },

  async historyByUser(userId, limit = 20, offset = 0) {
    return prisma.tokenTransfer.findMany({
      where: {
        OR: [{ sender_user_id: userId }, { recipient_user_id: userId }],
      },
      orderBy: { created_at: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });
  },
};

module.exports = { TransactionModel, TokenTransferModel };
