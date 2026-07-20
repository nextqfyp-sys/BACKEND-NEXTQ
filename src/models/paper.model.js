'use strict';

const { prisma } = require('../config/database');

const PaperModel = {
  async findById(id) {
    return prisma.paper.findUnique({ where: { id } });
  },

  async create(userId, subject, paperPayload, downloadUrl, tokensSpent) {
    return prisma.paper.create({
      data: {
        user_id: userId,
        subject,
        paper_payload: paperPayload || undefined,
        download_url: downloadUrl || undefined,
        tokens_spent: tokensSpent,
      },
    });
  },

  async historyByUser(userId, limit = 20, offset = 0) {
    const items = await prisma.paper.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });
    return { items, limit: Number(limit), offset: Number(offset) };
  },

  async countByUser(userId) {
    return prisma.paper.count({ where: { user_id: userId } });
  },
};

module.exports = { PaperModel };
