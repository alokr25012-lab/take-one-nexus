const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
const isSupabaseConfigured = supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== 'https://your-project.supabase.co' &&
  supabaseAnonKey !== 'your-anon-key';

if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('[Supabase] Client initialized successfully.');
  } catch (err) {
    console.error('[Supabase] Initialization failed:', err.message);
  }
} else {
  console.warn('[Supabase] Warning: Supabase is not configured. Falling back to local disk storage.');
}

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[Supabase] sharp is not available. Image compression bypassed.');
}

/**
 * Compresses an image buffer if sharp is available.
 */
async function compressImage(buffer, contentType) {
  if (!sharp || !contentType || !contentType.startsWith('image/')) {
    return buffer;
  }
  try {
    let pipeline = sharp(buffer);
    if (contentType === 'image/png') {
      return await pipeline.png({ quality: 80, compressionLevel: 8 }).toBuffer();
    } else if (contentType === 'image/webp') {
      return await pipeline.webp({ quality: 80 }).toBuffer();
    } else {
      return await pipeline.jpeg({ quality: 80, progressive: true }).toBuffer();
    }
  } catch (err) {
    console.error('[Supabase Compression] Image compression failed:', err.message);
    return buffer;
  }
}

/**
 * Upload file to Supabase Storage with local fallback.
 * @param {Buffer} buffer - File buffer
 * @param {string} bucket - Bucket/folder name ('profiles', 'communities', 'posts', 'portfolios')
 * @param {string} fileName - Destination filename
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Public URL of the uploaded asset
 */
async function uploadToStorage(buffer, bucket, fileName, contentType) {
  // Compress if it is an image
  const uploadBuffer = await compressImage(buffer, contentType);

  if (supabase) {
    try {
      // 1. Upload to bucket
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, uploadBuffer, {
          contentType,
          upsert: true
        });

      if (error) {
        throw error;
      }

      // 2. Get Public URL
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      if (!urlData || !urlData.publicUrl) {
        throw new Error('Failed to retrieve public URL from Supabase Storage');
      }

      console.log(`[Supabase Storage] Successfully uploaded to ${bucket}/${fileName}`);
      return urlData.publicUrl;
    } catch (err) {
      console.error('[Supabase Storage] Upload error, falling back to disk:', err.message);
    }
  }

  // Fallback to local storage (production-grade backwards compatibility)
  const localDir = path.resolve(__dirname, '..', 'public', 'assets', 'uploads', bucket);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const localPath = path.join(localDir, fileName);
  fs.writeFileSync(localPath, uploadBuffer);
  
  // Return the relative URL served by Express static middleware
  return `/uploads/${bucket}/${fileName}`;
}

module.exports = {
  uploadToStorage,
  isSupabaseConfigured
};
