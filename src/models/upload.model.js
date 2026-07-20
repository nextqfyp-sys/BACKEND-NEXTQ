'use strict';

const { prisma } = require('../config/database');

const UploadModel = {
  async findById(id) {
    return prisma.upload.findUnique({ where: { id } });
  },

  async create(userId, filename, storagePath) {
    return prisma.upload.create({
      data: { user_id: userId, filename, storage_path: storagePath },
    });
  },

  async updateScoring(id, status, aiScore, rewardTokens) {
    return prisma.upload.update({
      where: { id },
      data: { status, ai_score: aiScore, reward_tokens: rewardTokens },
    });
  },

  async historyByUser(userId, limit = 20, offset = 0) {
    return prisma.upload.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });
  },
};

module.exports = { UploadModel };
