'use strict';

const { prisma } = require('../config/database');

const UserModel = {
  async findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByWallet(walletAddress) {
    return prisma.user.findUnique({ where: { wallet_address: walletAddress } });
  },

  /**
   * Create a new user.
   * @param {string} walletAddress
   * @param {string|null} email
   * @param {'student'|'admin'|'content_moderator'} role  — defaults to 'student'
   */
  async create(walletAddress, email = null, role = 'student') {
    return prisma.user.create({
      data: { wallet_address: walletAddress, email, role },
    });
  },

  async markSignupBonusGranted(id) {
    return prisma.user.update({
      where: { id },
      data: { signup_bonus_granted: true },
    });
  },

  async updateEmail(id, email) {
    return prisma.user.update({
      where: { id },
      data: { email },
    });
  },

  async updateRole(id, role) {
    return prisma.user.update({
      where: { id },
      data: { role },
    });
  },
};

const BalanceModel = {
  async getByUserId(userId) {
    return prisma.balance.findUnique({ where: { user_id: userId } });
  },

  async getBalance(userId) {
    const row = await prisma.balance.findUnique({ where: { user_id: userId } });
    return row ? Number(row.token_balance) : 0;
  },

  async createIfMissing(userId) {
    return prisma.balance.upsert({
      where: { user_id: userId },
      update: {},
      create: { user_id: userId, token_balance: 0 },
    });
  },

  async setBalance(userId, newBalance) {
    return prisma.balance.upsert({
      where: { user_id: userId },
      update: { token_balance: newBalance },
      create: { user_id: userId, token_balance: newBalance },
    });
  },
};

module.exports = { UserModel, BalanceModel };
