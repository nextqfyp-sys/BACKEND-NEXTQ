'use strict';

const { Router } = require('express');
const {
  getStats,
  getUsers,
  getPapers,
  getPaperPayload,
  getUploads,
  getTransactions,
  createModerator,
  deleteModerator,
  resetModeratorPassword,
} = require('../controllers/admin.controller');
const { requireAuth, requireAdmin, requireRole } = require('../middleware/authenticate');

const router = Router();

// Require authentication for all admin routes
router.use(requireAuth);

// ── Routes accessible by both admin AND content_moderator ────────────────
const modOrAdmin = requireRole('admin', 'content_moderator');
router.get('/stats',   modOrAdmin, getStats);
router.get('/papers',  modOrAdmin, getPapers);
router.get('/papers/:id/payload', modOrAdmin, getPaperPayload);
router.get('/uploads', modOrAdmin, getUploads);

// ── Admin-only routes ────────────────────────────────────────────────────
router.get('/users',        requireAdmin, getUsers);
router.get('/transactions', requireAdmin, getTransactions);
router.post('/moderators',                      requireAdmin, createModerator);
router.delete('/moderators/:id',                requireAdmin, deleteModerator);
router.post('/moderators/:id/reset-password',   requireAdmin, resetModeratorPassword);

module.exports = router;
