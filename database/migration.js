require('dotenv').config();
const { pool } = require('../config/db');

async function migratePortfolioItems() {
  console.log('--- TAKE ONE Database Migration: Portfolio Decoupling ---');
  
  const connection = await pool.getConnection();
  try {
    // 1. Fetch all scripts that are portfolio items
    const [scriptsToMigrate] = await connection.query(
      `SELECT id, user_id, title, genre, synopsis, media_links, role_data, work_type, status, created_at, updated_at
       FROM scripts
       WHERE work_type = 'Portfolio Item'
          OR payment_status = 'portfolio'`
    );

    console.log(`Found ${scriptsToMigrate.length} portfolio items to migrate.`);

    if (scriptsToMigrate.length === 0) {
      console.log('No portfolio items found in the scripts table. Migration complete.');
      return;
    }

    // Start Transaction
    await connection.beginTransaction();
    console.log('Transaction started.');

    let successCount = 0;
    for (const item of scriptsToMigrate) {
      // If user_id is null, skip (or set a default if user doesn't exist, but usually it exists)
      if (!item.user_id) {
        console.warn(`Skipping item ID ${item.id} because user_id is null.`);
        continue;
      }

      console.log(`Migrating item ID ${item.id}: "${item.title}" for user ${item.user_id}...`);

      // 2. Insert into portfolio_work
      await connection.query(
        `INSERT INTO portfolio_work (
          id, user_id, title, genre, synopsis, media_links, role_data, work_type, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.user_id,
          item.title,
          item.genre,
          item.synopsis,
          item.media_links,
          item.role_data,
          item.work_type || 'Portfolio Item',
          item.status || 'Portfolio Item',
          item.created_at,
          item.updated_at
        ]
      );

      successCount++;
    }

    // 3. Delete those items from scripts table
    if (successCount > 0) {
      const migratedIds = scriptsToMigrate.map(item => item.id).filter(id => id);
      console.log(`Deleting ${migratedIds.length} migrated records from the scripts table...`);
      
      await connection.query(
        `DELETE FROM scripts WHERE id IN (?)`,
        [migratedIds]
      );
    }

    // Commit Transaction
    await connection.commit();
    console.log(`Successfully migrated ${successCount} portfolio items! Transaction committed.`);
  } catch (error) {
    console.error('Migration failed, rolling back transaction:', error.message);
    try {
      await connection.rollback();
    } catch (rbErr) {
      console.error('Rollback failed:', rbErr.message);
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

migratePortfolioItems().catch(err => {
  console.error('Unhandled migration error:', err);
  process.exit(1);
});
