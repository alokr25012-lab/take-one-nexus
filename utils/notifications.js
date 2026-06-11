const { pool } = require('../config/db');
let tableEnsured = false;
async function ensureNotificationsTable() {
  if (tableEnsured) return;
  await pool.query(`
   CREATE TABLE IF NOT EXISTS notifications (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      type VARCHAR(80) NOT NULL,
      title VARCHAR(160) NOT NULL,
      body TEXT NULL,
      link_url VARCHAR(255) DEFAULT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_notifications_user_read (user_id, is_read, created_at),
      CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    )
  `);
  tableEnsured = true;
}

async function createNotification({ userId, type, title, body = null, linkUrl = null }) {
  await ensureNotificationsTable();

  const [result] = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link_url)
     VALUES (?, ?, ?, ?, ?)`,
    [
      Number(userId),
      String(type || 'general').trim(),
      String(title || 'Notification').trim(),
      body ? String(body).trim() : null,
      linkUrl ? String(linkUrl).trim() : null
    ]
  );

  return result.insertId;
}

async function listNotifications(userId) {
  await ensureNotificationsTable();

  const [rows] = await pool.query(
    `SELECT id, type, title, body, link_url, is_read, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 30`,
    [Number(userId)]
  );

  return rows;
}

async function unreadNotificationCount(userId) {
  await ensureNotificationsTable();

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS unread_count
     FROM notifications
     WHERE user_id = ? AND is_read = 0`,
    [Number(userId)]
  );

  return Number(rows[0]?.unread_count || 0);
}

module.exports = {
  createNotification,
  ensureNotificationsTable,
  listNotifications,
  unreadNotificationCount
};
