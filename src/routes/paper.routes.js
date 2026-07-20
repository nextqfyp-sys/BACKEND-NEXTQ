'use strict';

const { Router } = require('express');
const {
  generatePaper,
  generateUnverifiedPaper,
  recordPaper,
  recordUnverifiedPaper,
  downloadPaper,
  paperHistory,
} = require('../controllers/paper.controller');
const { requireAuth } = require('../middleware/authenticate');
const { paperRateLimit } = require('../middleware/rateLimit');

const router = Router();

router.use(requireAuth);

router.post('/generate', paperRateLimit, generatePaper);
router.post('/generate-unverified', paperRateLimit, generateUnverifiedPaper);
router.post('/record', recordPaper);
router.post('/record-unverified', recordUnverifiedPaper);
router.get('/download/:paperId', downloadPaper);
router.get('/history', paperHistory);

module.exports = router;
