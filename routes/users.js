const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { authenticateUser, requireSameUser } = require('../middleware/auth');
const { sendWelcomeEmail, sendVerificationEmail } = require('../utils/email');
const prisma = require('../utils/prisma');
const { formatDisplayName, getCanonicalDisplayName } = require('../utils/formatting');
const Pusher = require('pusher');
const { createRateLimiter } = require('../middleware/rateLimiter');

const { body } = require('express-validator');
const { validateRequest } = require('../middleware/validator');


const router = express.Router();

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Rate limiters
const loginLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'login',
});

const registerLimiter = createRateLimiter({
  limit: 3,
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'register',
});

const analyticsTrackLimiter = createRateLimiter({
  limit: 60, // 60 track events per 15 minutes
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'analytics-track',
});

const authenticatedApiLimiter = createRateLimiter({
  limit: 100, // 100 requests per 15 minutes
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'auth-api',
});

const profileUpdateLimiter = createRateLimiter({
  limit: 30, // 30 profile updates per 15 minutes
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'profile-update',
});

const avatarUploadLimiter = createRateLimiter({
  limit: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'avatar-upload',
});


// Ensure the target server-side upload directory exists
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id || 'anonymous';
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${userId}-${Date.now()}${ext}`);
  }
});

// Image filter validation
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Format rejected. Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});


// Configure Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true
});

function createToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  
  // Ensure primary admin/dev email always has the Developer role in the session token
  const role = user.role || '';

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: role,
      // secondary_role is critical — requireAdmin/requireSecondaryRole checks this field.
      // Without it, admin subdomain access always fails, causing the redirect loop.
      secondary_role: user.secondary_role || null,
      email_verified: user.email_verified === 1 || user.email_verified === true
    },
    secret,
    { expiresIn: '10d' }
  );
}

/**
 * Build cookie options for the auth token.
 * In production on the custom domain, `domain` is set to the apex domain so
 * the cookie is shared across takeone-nexus.net.in AND admin.takeone-nexus.net.in.
 * On Vercel preview deployments, `domain` is left undefined so the browser
 * scopes the cookie to the active Vercel subdomain automatically.
 */
function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const isVercelPreview = Boolean(process.env.VERCEL_URL?.includes('vercel.app'));
  return {
    httpOnly: true,
    secure: true, // Always secure to protect tokens and satisfy CodeQL checks
    sameSite: isProd ? 'None' : 'Lax',
    path: '/',
    maxAge: 10 * 24 * 60 * 60 * 1000, // 10 days
    // Only pin the domain on the custom production domain.
    // On Vercel previews, leave domain undefined so the browser uses the
    // current host automatically (e.g. take-one-nexus.vercel.app).
    domain: isProd && !isVercelPreview ? '.takeone-nexus.net.in' : undefined
  };
}

async function getProfileData(userId) {
  const [userRows] = await pool.query(
    `SELECT id, name, email, role, secondary_role, college, city, bio, skills, portfolio, avatar_url, gender, credits, screen_name, display_preference, social_links, email_verified, created_at, availability
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  if (userRows.length === 0) {
    return null;
  }

  const [scriptRows] = await pool.query(
    `SELECT
        id,
        title,
        genre,
        status,
        roles_needed,
        poster_url,
        work_type,
        media_links,
        role_data,
        payment_status,
        created_at
    FROM scripts
    WHERE user_id = ?
    AND (
      payment_verified = TRUE
      OR payment_status = 'portfolio'
    )
    ORDER BY created_at DESC, id DESC`,
    [userId]
  );

  return {
    ...userRows[0],
    name: formatDisplayName(userRows[0].name),
    email_verified: userRows[0].email_verified === 1 || userRows[0].email_verified === true,
    scripts: scriptRows
  };
}

const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name is too long'),
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').notEmpty().withMessage('Role is required').not().equals('Select Role').withMessage('Please select a valid role'),
  body('gender').notEmpty().withMessage('Gender is required').not().equals('Choose Gender').withMessage('Please select your gender'),
  body('display_preference').notEmpty().withMessage('Display preference is required').not().equals('Select Display Preference').withMessage('Please select a display preference'),
  validateRequest
];

router.post('/register', registerLimiter, registerValidation, async (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  try {
    const { name, email: normalizedEmail, password, role, college, city, gender, screen_name, display_preference } = req.body;
    
    if (!isProd) {
      console.log(`[AUTH_DEBUG] Registration attempt for email: ${normalizedEmail}`);
    }

    // Check for existing user
    let existingUsers;
    try {
      [existingUsers] = await pool.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [normalizedEmail]
      );
    } catch (dbError) {
      console.error('[DB] Register check failed:', dbError.message);
      throw dbError; // Caught by outer try-catch
    }

    if (existingUsers && existingUsers.length > 0) {
      if (!isProd) {
        console.log(`[AUTH_DEBUG] ❌ Registration failed: Email already registered: ${normalizedEmail}`);
      }
      return res.status(409).json({
        success: false,
        message: 'This email is already registered. Please try logging in.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const [result] = await pool.query(
      `INSERT INTO users (name, email, password, role, college, city, gender, screen_name, display_preference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        normalizedEmail,
        hashedPassword,
        role || null,
        college || null,
        city || null,
        gender || 'Prefer not to say',
        screen_name || null,
        display_preference || 'Show Real Name Only'
      ]
    );

    const user = {
      id: result.insertId,
      name: formatDisplayName(name.trim()),
      email: normalizedEmail,
      role: role || '',
      college: college || '',
      city: city || '',
      gender: gender || 'Prefer not to say'
    };

    const token = createToken(user);
    const cookieOpts = getCookieOptions();
    
    if (!isProd) {
      console.log(`[AUTH_DEBUG] ✅ Registration success: Created user ${user.email} (ID: ${user.id})`);
      console.log(`[AUTH_DEBUG] Cookie options:`, {
        ...cookieOpts,
        value: '[REDACTED]'
      });
    }

    res.cookie('token', token, cookieOpts);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user_id: user.id,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        college: user.college,
        city: user.city,
        gender: user.gender,
        screen_name: screen_name || null,
        display_preference: display_preference || 'Show Real Name Only',
        credits: 0
      },
      token: token
    });

    // Send welcome email asynchronously (non-blocking)
    sendWelcomeEmail(user.email, user.name).catch(err => {
      console.error('[Registration] Background email task failed:', err.message);
    });

    // Send verification email asynchronously via Resend
    (async () => {
      try {
        const token = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            verification_token: hashedToken,
            verification_token_expires: expiry,
          },
        });

        // Transmission: Send Cinematic Verification Email
        await sendVerificationEmail(user.email, user.name, token);
      } catch (verifyErr) {
        console.error('[Registration] Verification email failed:', verifyErr.message);
      }
    })();

    // Trigger Pusher update for admin dashboard
    if (process.env.PUSHER_APP_ID) {
      pusher.trigger('admin-dashboard', 'update', {
        type: 'USER_CREATED',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          college: user.college,
          city: user.city,
          created_at: new Date().toISOString()
        }
      });
    }
  } catch (error) {
    console.error('--- Registration Failed ---');
    console.error(`Error Type: ${error.constructor.name}`);
    console.error(`Error Code: ${error.code}`);
    console.error(`Error Message: ${error.message}`);
    
    // JWT configuration error
    if (error.message.includes('JWT_SECRET')) {
      return res.status(500).json({
        success: false,
        message: 'Authentication system is not configured. Please contact the administrator.'
      });
    }

    // Database duplicate entry
    if (error.code === 'ER_DUP_ENTRY' || error.message.includes('Duplicate entry')) {
      return res.status(409).json({
        success: false,
        message: 'This email is already registered. Please try logging in.'
      });
    }

    // Database connection issues
    const connErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR'];
    if (connErrors.includes(error.code) || error.message.includes('connect')) {
      return res.status(503).json({
        success: false,
        message: 'The database is currently unavailable. We are working to restore the connection. Please try again in a few minutes.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during registration. Please try again later.'
    });
  }
});


const loginValidation = [
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  validateRequest
];

router.post('/login', loginLimiter, loginValidation, async (req, res) => {
  const { email: normalizedEmail, password } = req.body;
  const isProd = process.env.NODE_ENV === 'production';
  
  try {
    if (!isProd) {
      console.log(`[AUTH_DEBUG] Login attempt for email: ${normalizedEmail}`);
    }

    let rows;
    try {
      [rows] = await pool.query(
        `SELECT id, name, email, password, role, secondary_role, college, city, gender, screen_name, display_preference, social_links, credits, email_verified
         FROM users
         WHERE email = ?
         LIMIT 1`,
        [normalizedEmail]
      );
    } catch (dbError) {
      console.error('[DB] Login query failed:', dbError.message);
      throw dbError;
    }

    if (!rows || rows.length === 0) {
      if (!isProd) {
        console.log(`[AUTH_DEBUG] ❌ Login failed: User not found for email: ${normalizedEmail}`);
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      if (!isProd) {
        console.log(`[AUTH_DEBUG] ❌ Login failed: Password mismatch for email: ${normalizedEmail}`);
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = createToken(user);
    const cookieOpts = getCookieOptions();
    
    if (!isProd) {
      console.log(`[AUTH_DEBUG] ✅ Login success: Generated session token for user: ${user.email} (ID: ${user.id})`);
      console.log(`[AUTH_DEBUG] Cookie options:`, {
        ...cookieOpts,
        value: '[REDACTED]'
      });
    }

    res.cookie('token', token, cookieOpts);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: formatDisplayName(user.name),
        email: user.email,
        role: user.role || '',
        secondary_role: user.secondary_role || null,
        college: user.college || '',
        city: user.city || '',
        gender: user.gender || 'Prefer not to say',
        screen_name: user.screen_name || null,
        display_preference: user.display_preference || 'Show Real Name Only',
        social_links: user.social_links || null,
        credits: user.credits || 0,
        email_verified: user.email_verified === 1 || user.email_verified === true
      },
      token: token
    });
  } catch (error) {
    console.error('--- Login Crash ---');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    if (error.message.includes('JWT_SECRET')) {
      return res.status(500).json({
        success: false,
        message: 'Authentication system is not configured. Please contact the administrator.'
      });
    }

    const connErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR'];
    if (connErrors.includes(error.code) || error.message.includes('connect')) {
      return res.status(503).json({
        success: false,
        message: 'The database is currently unavailable. Please try again later.'
      });
    }

    res.status(500).json({
      success: false,
      message: `Login failed: ${error.message || 'Internal Server Error'}`
    });
  }
});

router.post('/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  
  if (!isProd) {
    console.log(`[AUTH_DEBUG] Logout request received. Clearing auth token cookie.`);
  }

  res.clearCookie('token', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'None' : 'Lax',
    path: '/',
    domain: isProd && !Boolean(process.env.VERCEL_URL?.includes('vercel.app')) ? '.takeone-nexus.net.in' : undefined
  });
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});


async function safeQuery(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error(`Database query failed: ${sql}`);
    console.error(`Error: ${error.message}`);
    const { captureError } = require('../src/lib/sentry');
    captureError(error, {
      action: 'database_query_failure',
      extra: { sql, params }
    });
    throw error;
  }
}

/**
 * GET /api/users/me
 * Get current authenticated user data from session
 */
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const profile = await getProfileData(userId);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Auto cookie update if database says verified but token says unverified
    if (profile.email_verified === true && req.user.email_verified !== true) {
      try {
        const updatedUser = {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          secondary_role: req.user.secondary_role || null,
          email_verified: true
        };
        const token = createToken(updatedUser);
        res.cookie('token', token, getCookieOptions());
      } catch (tokenErr) {
        console.error('[AUTH_DEBUG] Failed to auto-update verification cookie:', tokenErr.message);
      }
    }

    res.json({
      success: true,
      user: profile,
      pusherKey: process.env.NEXT_PUBLIC_PUSHER_KEY,
      pusherCluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    });
  } catch (error) {
    console.error('Fetch me error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not load session data'
    });
  }
});


router.get('/search', authenticateUser, async (req, res) => {
  try {
    const role = String(req.query.role || '').trim();
    const city = String(req.query.city || '').trim();
    const availability = String(req.query.availability || '').trim();
    const q = String(req.query.q || '').trim();
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    const offset = (page - 1) * limit;

    let countSql = `
      SELECT COUNT(*) as total
      FROM users
      WHERE id != ?
    `;
    const countParams = [req.user.id];

    let sql = `
      SELECT id, name, email, role, college, city, bio, skills, avatar_url, gender, credits, screen_name, display_preference, social_links, created_at, email_verified, availability
      FROM users
      WHERE id != ?
    `;
    const params = [req.user.id];

    if (role) {
      sql += ` AND role LIKE ?`;
      params.push(`%${role}%`);
      countSql += ` AND role LIKE ?`;
      countParams.push(`%${role}%`);
    }

    if (city) {
      sql += ` AND city LIKE ?`;
      params.push(`%${city}%`);
      countSql += ` AND city LIKE ?`;
      countParams.push(`%${city}%`);
    }

    if (availability) {
      sql += ` AND availability = ?`;
      params.push(availability);
      countSql += ` AND availability = ?`;
      countParams.push(availability);
    }

    if (q) {
      sql += ` AND (name LIKE ? OR screen_name LIKE ? OR role LIKE ? OR college LIKE ? OR skills LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      countSql += ` AND (name LIKE ? OR screen_name LIKE ? OR role LIKE ? OR college LIKE ? OR skills LIKE ?)`;
      countParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    // Execute count query
    const countRows = await safeQuery(countSql, countParams);
    const total = countRows && countRows[0] ? Number(countRows[0].total) : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    sql += ` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await safeQuery(sql, params);
    const mappedRows = rows.map(r => ({ ...r, name: formatDisplayName(r.name) }));

    res.json({
      success: true,
      count: mappedRows.length,
      data: mappedRows,
      users: mappedRows, // Supporting both data and users fields
      total,
      totalPages,
      page,
      limit
    });
  } catch (error) {
    console.error('User search error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not search users'
    });
  }
});

router.get('/admin/list', authenticateUser, authenticatedApiLimiter, async (req, res) => {
  try {
    const role = String(req.user.role || '').toLowerCase();
    const secondaryRole = String(req.user.secondary_role || '').toLowerCase();
    // Mirrors existing requireAdmin behavior while preserving
    // developer/moderator access already granted by this route.
    const isAuthorized =
      role === 'developer' ||
      role === 'admin' ||
      role === 'moderator' ||
      secondaryRole === 'admin';

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const rows = await safeQuery(
      `SELECT id, name, email, role, college, city, created_at
       FROM users
       ORDER BY created_at DESC, id DESC
       LIMIT 500`
    );

    return res.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        name: formatDisplayName(row.name)
      }))
    });
  } catch (error) {
    console.error('Admin user list error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Could not load users'
    });
  }
});

router.put('/:id', authenticateUser, requireSameUser, profileUpdateLimiter, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const {
      name,
      role,
      college,
      city,
      bio,
      skills,
      portfolio,
      avatar_url,
      gender,
      screen_name,
      display_preference,
      social_links,
      availability
    } = req.body;

    if (name && typeof name === 'string' && !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Display name cannot be empty'
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name: name.trim() }),
        role: typeof role === 'string' ? role.trim() : undefined,
        college: typeof college === 'string' ? college.trim() : undefined,
        city: typeof city === 'string' ? city.trim() : undefined,
        bio: typeof bio === 'string' ? bio.trim() : undefined,
        skills: typeof skills === 'string' ? skills.trim() : undefined,
        portfolio: typeof portfolio === 'string' ? portfolio.trim() : undefined,
        avatar_url: typeof avatar_url === 'string' ? avatar_url.trim() : undefined,
        gender: typeof gender === 'string' ? gender.trim() : undefined,
        screen_name: typeof screen_name === 'string' ? screen_name.trim() : undefined,
        display_preference: typeof display_preference === 'string' ? display_preference.trim() : undefined,
        social_links: typeof social_links === 'string' ? social_links.trim() : undefined,
        availability: typeof availability === 'string' ? availability.trim() : undefined,
      },
      include: {
        scripts: {
          orderBy: { created_at: 'desc' }
        }
      }
    });

    // Trigger Pusher update for admin dashboard
    if (process.env.PUSHER_APP_ID) {
      pusher.trigger('admin-dashboard', 'update', {
        type: 'USER_UPDATED',
        user: {
          id: updatedUser.id,
          name: formatDisplayName(updatedUser.name),
          role: updatedUser.role,
          college: updatedUser.college,
          city: updatedUser.city
        }
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully via Prisma',
      data: {
        ...updatedUser,
        name: formatDisplayName(updatedUser.name)
      }
    });
  } catch (error) {
    console.error('Profile update error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not update profile'
    });
  }
});

router.get('/:id', authenticateUser, requireSameUser, async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Valid user id is required'
      });
    }

    const profile = await getProfileData(userId);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    console.error('Profile fetch error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not load profile'
    });
  }
});



/**
 * POST /api/users/upload-avatar
 * File-handling route for profile pictures
 */
router.post('/upload-avatar', authenticateUser, avatarUploadLimiter, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const userId = Number(req.user.id);
    
    // This is the public relative URL pointing to the file on disk
    const avatarUrl = `/uploads/${req.file.filename}`;

    // Update the database record using Prisma
    await prisma.user.update({
      where: { id: userId },
      data: { avatar_url: avatarUrl }
    });

    res.json({
      success: true,
      message: 'Avatar uploaded and saved successfully!',
      avatar_url: avatarUrl
    });
  } catch (error) {
    console.error('Avatar upload error:', error.message);
    res.status(500).json({ success: false, message: 'Server error uploading avatar' });
  }
});

/**
 * GET /api/users/public/:id
 * Get public profile data for any user
 */
router.get('/public/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Valid user id is required'
      });
    }

    const [userRows] = await pool.query(
      `SELECT id, name, role, college, city, bio, skills, portfolio, avatar_url, gender, credits, screen_name, display_preference, social_links, created_at, availability
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const [scriptRows] = await pool.query(
      `SELECT
          id,
          title,
          genre,
          synopsis,
          status,
          roles_needed,
          poster_url,
          work_type,
          media_links,
          role_data,
          payment_status,
          created_at
      FROM scripts
      WHERE user_id = ?
      AND (
        payment_verified = TRUE
        OR payment_status = 'portfolio'
      )
      ORDER BY created_at DESC, id DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        ...userRows[0],
        name: getCanonicalDisplayName(userRows[0]),
        scripts: scriptRows
      }
    });
  } catch (error) {
    console.error('Public profile fetch error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not load public profile'
    });
  }
});

/**
 * GET /api/users/leaderboard
 * Get top users ranked by credits
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const rows = await safeQuery(
      `SELECT id, name, role, college, city, avatar_url, gender, credits,
              screen_name, display_preference, email_verified
       FROM users
       WHERE credits >= 0
       ORDER BY credits DESC, name ASC
       LIMIT 100`
    );

    res.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        displayName: getCanonicalDisplayName(r)
      }))
    });
  } catch (error) {
    console.error('Leaderboard fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load leaderboard signal' });
  }
});

/**
 * GET /api/users/transactions
 * Get credit transaction history for the authenticated user
 */
router.get('/transactions', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const transactions = await prisma.creditTransaction.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50
    });

    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Transactions fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load transaction history' });
  }
});

// Allowed event types — reject anything outside this set to prevent abuse
const ALLOWED_EVENT_TYPES = new Set(['profile_view', 'portfolio_view', 'project_engagement']);

/**
 * POST /api/users/analytics/track
 * Track an analytics event (profile_view, portfolio_view, project_engagement)
 * Public endpoint — protected by event_type whitelist and target user existence check.
 */
router.post('/analytics/track', analyticsTrackLimiter, async (req, res) => {
  try {
    const { user_id, event_type, target_id } = req.body;

    if (!user_id || !event_type) {
      return res.status(400).json({ success: false, message: 'user_id and event_type are required' });
    }

    // Reject unknown event types — prevents arbitrary data injection
    if (!ALLOWED_EVENT_TYPES.has(event_type)) {
      return res.status(400).json({ success: false, message: 'Invalid event_type' });
    }

    // Validate the target user actually exists to prevent inflating counts for non-existent users
    const [targetRows] = await pool.query(
      'SELECT id FROM users WHERE id = ? LIMIT 1',
      [Number(user_id)]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Target user not found' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    
    // Salted hash using existing JWT_SECRET to protect visitor PII and prevent dictionary attacks
    const salt = process.env.JWT_SECRET || 'fallback-analytics-salt-v1';
    const hashedIp = crypto.createHash('sha256').update(String(ip) + salt).digest('hex').substring(0, 16);

    await prisma.analyticsEvent.create({
      data: {
        user_id: Number(user_id),
        event_type,
        target_id: target_id ? Number(target_id) : null,
        visitor_ip: hashedIp
      }
    });

    res.json({ success: true, message: 'Event tracked successfully' });
  } catch (error) {
    console.error('Analytics tracking error:', error.message);
    res.status(500).json({ success: false, message: 'Could not track event' });
  }
});

/**
 * GET /api/users/analytics/summary
 * Retrieve aggregated analytics summary for the currently logged-in user
 */
router.get('/analytics/summary', authenticateUser, authenticatedApiLimiter, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    // Get simple counts
    const profileViews = await prisma.analyticsEvent.count({
      where: { user_id: userId, event_type: 'profile_view' }
    });

    const portfolioViews = await prisma.analyticsEvent.count({
      where: { user_id: userId, event_type: 'portfolio_view' }
    });

    const projectEngagements = await prisma.analyticsEvent.count({
      where: { user_id: userId, event_type: 'project_engagement' }
    });

    // Get recent activity feed (avoid private info, just event type and timestamp)
    const recentEvents = await prisma.analyticsEvent.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 10
    });

    // Real per-day aggregation for the last 7 days (profile_view events only)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [dailyRows] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS views
       FROM analytics_events
       WHERE user_id = ? AND event_type = 'profile_view' AND created_at >= ?
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [userId, sevenDaysAgo]
    );

    // Build a full 7-day map so days with zero events still appear in the chart
    const dailyMap = {};
    dailyRows.forEach(row => {
      // row.day is a Date object from mysql2 — convert to ISO date string key
      const key = row.day instanceof Date
        ? row.day.toISOString().slice(0, 10)
        : String(row.day).slice(0, 10);
      dailyMap[key] = Number(row.views);
    });

    const dailyData = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      dailyData.push({ label, views: dailyMap[key] || 0 });
    }

    res.json({
      success: true,
      summary: {
        profileViews,
        portfolioViews,
        projectEngagements
      },
      chartData: dailyData,
      recentActivity: recentEvents.map(e => ({
        id: e.id,
        event_type: e.event_type,
        target_id: e.target_id,
        created_at: e.created_at
      }))
    });
  } catch (error) {
    console.error('Analytics summary error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load analytics summary' });
  }
});

router.createToken = createToken;
router.getCookieOptions = getCookieOptions;
module.exports = router;
