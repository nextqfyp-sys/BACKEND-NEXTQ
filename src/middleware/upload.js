'use strict';

const multer = require('multer');
const AppError = require('../utils/AppError');

const MAX_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// Store in memory — we pass the buffer to Cloudinary
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(AppError.badRequest(`File type '${file.mimetype}' is not allowed`));
    }
  },
});

module.exports = { upload };
