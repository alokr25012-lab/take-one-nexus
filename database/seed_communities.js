require('dotenv').config();
const { pool } = require('../config/db');

async function seedCommunities() {
  console.log('--- Seeding Community Pricing & Permissions ---');
  const connection = await pool.getConnection();
  try {
    // 1. Seed community_pricing_configs
    console.log('Checking community_pricing_configs...');
    const [existingConfigs] = await connection.query('SELECT * FROM community_pricing_configs');
    if (existingConfigs.length === 0) {
      await connection.query(`
        INSERT INTO community_pricing_configs (plan_type, base_price, max_members, per_member_price)
        VALUES 
          ('Growth', 99.00, 35, 0.00),
          ('Custom', 99.00, 1000, 2.00)
      `);
      console.log('✅ Seeded community pricing configs.');
    } else {
      // If already exists, update to correct base values
      await connection.query(`
        UPDATE community_pricing_configs 
        SET base_price = 99.00, max_members = 1000, per_member_price = 2.00
        WHERE plan_type = 'Custom'
      `);
      await connection.query(`
        UPDATE community_pricing_configs 
        SET base_price = 99.00, max_members = 35, per_member_price = 0.00
        WHERE plan_type = 'Growth'
      `);
      console.log('✅ Updated existing community pricing configs.');
    }

    // 2. Seed community_permissions
    console.log('Checking community_permissions...');
    const [existingPerms] = await connection.query('SELECT * FROM community_permissions');
    if (existingPerms.length === 0) {
      await connection.query(`
        INSERT INTO community_permissions (role, can_manage_groups, can_manage_members, can_write_messages)
        VALUES 
          ('Owner', true, true, true),
          ('Moderator', true, true, true),
          ('Member', false, false, true)
      `);
      console.log('✅ Seeded community permissions.');
    } else {
      console.log('community_permissions already seeded.');
    }

    console.log('--- Seeding Complete! ---');
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
  } finally {
    connection.release();
    await pool.end();
  }
}

seedCommunities().catch(err => {
  console.error(err);
  process.exit(1);
});
