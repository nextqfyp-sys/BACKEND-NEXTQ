'use strict';

const { Router } = require('express');
const { getBalance, sendTokens, tokenHistory, buyTokens } = require('../controllers/token.controller');
const { submitSignedTx } = require('../controllers/solana.controller');
const { requireAuth } = require('../middleware/authenticate');
const { sendRateLimit, buyRateLimit } = require('../middleware/rateLimit');

const router = Router();

router.use(requireAuth);

router.get('/balance', getBalance);
router.post('/send', sendRateLimit, sendTokens);
router.get('/history', tokenHistory);
router.post('/buy', buyRateLimit, buyTokens);
router.post('/submit-signed-tx', submitSignedTx);

module.exports = router;
