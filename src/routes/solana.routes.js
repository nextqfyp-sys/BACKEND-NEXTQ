'use strict';

const { Router } = require('express');
const { getBlockhash, prepareTransfer } = require('../controllers/solana.controller');
const { requireAuth } = require('../middleware/authenticate');

const router = Router();

router.use(requireAuth);

router.get('/blockhash', getBlockhash);
router.post('/prepare-transfer', prepareTransfer);

module.exports = router;
