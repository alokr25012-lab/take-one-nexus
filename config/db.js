const mysql = require('mysql2/promise');

// Parse DATABASE_URL if available (common in managed MySQL providers)
const parseConnectionString = (url) => {
  try {
    const parsed = new URL(url);
    return {
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      host: parsed.hostname,
      port: Number(parsed.port) || 3306,
      database: decodeURIComponent(parsed.pathname.slice(1)),
    };
  } catch (err) {
    console.error('[DB] Failed to parse DATABASE_URL:', err.message);
  }
  return null;
};

const dbConfig = process.env.DATABASE_URL 
  ? parseConnectionString(process.env.DATABASE_URL)
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'take_one',
    };

const poolConfig = {
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 5, // Lower limit is better for serverless to prevent exhaustion
  maxIdle: 5,
  idleTimeout: 60000,
  queueLimit: 0,
  connectTimeout: 20000,
  // Optimized SSL for TiDB Cloud / Aiven / PlanetScale
  ssl: (process.env.DB_SSL === 'true' || process.env.DATABASE_URL?.includes('ssl')) 
    ? { 
        rejectUnauthorized: false, // More compatible with various cloud environments
        minVersion: 'TLSv1.2'
      } 
    : undefined
};

const pool = mysql.createPool(poolConfig);

async function connectDB() {
  const { host, database, user } = dbConfig;
  const maxRetries = 5;
  let attempt = 1;
  let delay = 1000; // Start with 1 second delay
  
  if (!process.env.DB_HOST && !process.env.DATABASE_URL) {
    console.warn('--- DATABASE CONFIGURATION WARNING ---');
    console.warn('Neither DB_HOST nor DATABASE_URL is set.');
    console.warn('Defaulting to localhost which may fail in production.');
    console.warn('--------------------------------------');
  }

  while (attempt <= maxRetries) {
    try {
      console.log(`[DB] Attempting connection to ${database} at ${host} (Attempt ${attempt}/${maxRetries})...`);
      
      const connection = await pool.getConnection();
      console.log('[DB] ✅ MySQL connected successfully');
      
      // Quick check to see if we can query
      const [rows] = await connection.query('SELECT 1 as connected');
      if (rows[0].connected === 1) {
        console.log('[DB] ✅ Query test passed');
      }
      
      connection.release();
      return; // Success, exit retry loop
    } catch (error) {
      console.error(`[DB] ❌ Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      
      if (attempt === maxRetries) {
        console.error('[DB] ❌ CRITICAL: All MySQL connection attempts failed!');
        console.error(`[DB] Target: ${user}@${host}/${database}`);
        console.error(`[DB] Error Code: ${error.code}`);
        
        if (error.code === 'ECONNREFUSED') {
          console.error('[DB] HINT: Connection refused. Check if the DB host is reachable and the port is correct.');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
          console.error('[DB] HINT: Access denied. Check your DB_USER and DB_PASSWORD.');
        } else if (error.message.includes('SSL')) {
          console.error('[DB] HINT: SSL error. Try setting DB_SSL=true if your provider requires encrypted connections.');
        }
      } else {
        console.log(`[DB] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
      attempt++;
    }
  }
}

module.exports = {
  pool,
  connectDB,
  dbConfig
};

