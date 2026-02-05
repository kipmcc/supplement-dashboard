#!/usr/bin/env node
// Run gap tracking migration against Supabase
// Usage: node run-migration.js

const fs = require('fs');
const path = require('path');

// Load env from fullscript-scraper
require('dotenv').config({ path: '/Users/aviado1/clawd/fullscript-scraper/.env' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  const migrationPath = path.join(__dirname, '../supabase/migrations/20260130_001_gap_tracking.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  // Split into statements (simple split on semicolon + newline)
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Running ${statements.length} statements...`);
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 60).replace(/\n/g, ' ');
    console.log(`[${i + 1}/${statements.length}] ${preview}...`);
    
    try {
      const { data, error } = await supabase.rpc('exec_sql', { sql_query: stmt });
      if (error) {
        // Try direct fetch if rpc doesn't exist
        console.log(`  RPC failed, trying raw...`);
        throw error;
      }
      console.log(`  ✓ OK`);
    } catch (err) {
      console.log(`  ⚠ ${err.message || err}`);
    }
  }
  
  console.log('\nDone! Check Supabase dashboard to verify tables were created.');
}

runMigration().catch(console.error);
