// Quick Supabase connection & bucket test script
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

console.log('\n=== Supabase Connection Test ===\n');
console.log('SUPABASE_URL     :', url || '❌ NOT SET');
console.log('SUPABASE_ANON_KEY:', key ? key.substring(0, 30) + '...' : '❌ NOT SET');
console.log('');

if (!url || !key) {
  console.error('❌ FAILED: Supabase env variables are missing.');
  process.exit(1);
}

const supabase = createClient(url, key);

const BUCKETS = ['profiles', 'communities', 'posts', 'portfolios'];

async function test() {
  console.log('--- Required Bucket Check (via file listing) ---');
  let allPresent = true;

  for (const bucket of BUCKETS) {
    const { data, error } = await supabase.storage.from(bucket).list('', { limit: 1 });

    if (error) {
      console.log(`  ❌  "${bucket}" — ERROR: ${error.message}`);
      allPresent = false;
    } else {
      console.log(`  ✅  "${bucket}" — accessible`);
    }
  }

  console.log('');
  if (allPresent) {
    console.log('🎉 Supabase is fully connected and all buckets are accessible!');
  } else {
    console.log('⚠️  Some buckets had errors. Check your Supabase bucket policies.');
  }
  console.log('');
}

test().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
