'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Upload a buffer to Cloudinary.
 * @param {Buffer} buffer - file bytes
 * @param {string} originalName - original filename (for public_id)
 * @param {string} mimeType - e.g. 'application/pdf'
 * @returns {{ publicId: string, secureUrl: string }}
 */
async function uploadToCloudinary(buffer, originalName, mimeType) {
  return new Promise((resolve, reject) => {
    const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const publicId = `uploads/${Date.now()}-${sanitized}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'raw',
        type: 'upload',
        format: mimeType === 'application/pdf' ? 'pdf' : undefined,
      },
      (error, result) => {
        if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        resolve({ publicId: result.public_id, secureUrl: result.secure_url });
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Delete a resource from Cloudinary by its public_id.
 */
async function deleteFromCloudinary(publicId) {
  return cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
}

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };
