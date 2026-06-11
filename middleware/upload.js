const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Determine upload directory: Vercel serverless functions only have write permissions in /tmp
const uploadDir = process.env.VERCEL
  ? path.join('/tmp', 'logos')
  : path.resolve(__dirname, '..', 'public', 'assets', 'uploads', 'logos');

if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (err) {
    console.warn(`[Upload Config] Warning: Failed to create upload directory "${uploadDir}":`, err.message);
  }
}

// Configure disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `community-logo-${uniqueSuffix}${ext}`);
  }
});

// Configure file filter (accept only JPEG, PNG, WEBP)
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and WEBP images are allowed.'), false);
  }
};

// Multer upload config
const uploadLogo = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB limit
  },
  fileFilter: fileFilter
});

module.exports = {
  uploadLogo
};
