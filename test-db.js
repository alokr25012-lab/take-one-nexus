require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const mysql = require('mysql2/promise');

async function testMysql() {
  console.log('--- Testing mysql2 connection ---');
  try {
    const url = process.env.DATABASE_URL;
    console.log('DATABASE_URL:', url ? url.substring(0, 30) + '...' : 'undefined');
    
    // Parse DATABASE_URL
    const regex = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
    const match = url.match(regex);
    if (!match) {
      throw new Error('Invalid DATABASE_URL format');
    }
    const config = {
      user: match[1],
      password: match[2],
      host: match[3],
      port: Number(match[4]),
      database: match[5].split('?')[0],
      ssl: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      }
    };
    
    console.log('Connecting to:', config.host, 'port:', config.port);
    const connection = await mysql.createConnection(config);
    console.log('✅ mysql2 Connected successfully!');
    const [rows] = await connection.query('SELECT 1 as val');
    console.log('Query output:', rows);
    await connection.end();
  } catch (err) {
    console.error('❌ mysql2 connection failed:', err);
  }
}

async function testPrisma() {
  console.log('\n--- Testing Prisma connection ---');
  const prisma = new PrismaClient();
  try {
    const res = await prisma.$queryRaw`SELECT 1 as val`;
    console.log('✅ Prisma Connected successfully!');
    console.log('Query output:', res);
  } catch (err) {
    console.error('❌ Prisma connection failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

async function run() {
  await testMysql();
  await testPrisma();
}

run();
