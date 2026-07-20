'use strict';

const { Router } = require('express');
const { submitUpload, uploadStatus, uploadHistory } = require('../controllers/upload.controller');
const { requireAuth } = require('../middleware/authenticate');
const { uploadRateLimit } = require('../middleware/rateLimit');
const { upload } = require('../middleware/upload');

const router = Router();

router.use(requireAuth);

router.post('/submit', uploadRateLimit, upload.single('file'), submitUpload);
router.get('/status/:uploadId', uploadStatus);
router.get('/history', uploadHistory);

module.exports = router;
