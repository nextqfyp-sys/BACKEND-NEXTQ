'use strict';

const { prisma } = require('../config/database');

const QuizModel = {
  async findById(id) {
    return prisma.quiz.findUnique({ where: { id } });
  },

  async create(userId, subject, questions, tokensSpent) {
    return prisma.quiz.create({
      data: { user_id: userId, subject, questions, tokens_spent: tokensSpent },
    });
  },

  async updateQuestions(id, questions) {
    return prisma.quiz.update({
      where: { id },
      data: { questions },
    });
  },

  async submitAnswers(id, answers, score) {
    return prisma.quiz.update({
      where: { id },
      data: { answers, score },
    });
  },

  async historyByUser(userId, limit = 20, offset = 0) {
    const items = await prisma.quiz.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });
    return { items, limit: Number(limit), offset: Number(offset) };
  },

  async countByUser(userId) {
    return prisma.quiz.count({ where: { user_id: userId } });
  },
};

module.exports = { QuizModel };
