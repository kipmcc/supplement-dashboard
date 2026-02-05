#!/usr/bin/env node
/**
 * Insert scraped products into Supabase canonical_products table
 */

const fs = require('fs');

const SUPABASE_URL = 'https://xijsvdhffiuxpepswnyb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjE3NTQ1NiwiZXhwIjoyMDgxNzUxNDU2fQ.1ZtXR6eQehlEkK_cgZu6GB1oERciPOedy6D2whwNEQ4';

async function checkExisting(brand) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/canonical_products?brand=eq.${encodeURIComponent(brand)}&select=canonical_name`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  );
  const existing = await response.json();
  return new Set(existing.map(p => p.canonical_name.toLowerCase()));
}

async function insertProducts(products) {
  // Check existing products for this brand
  const brand = products[0]?.brand;
  if (!brand) {
    console.error('No brand found in products');
    return;
  }
  
  console.error(`Checking existing ${brand} products...`);
  const existingNames = await checkExisting(brand);
  console.error(`Found ${existingNames.size} existing products`);
  
  // Filter to new products only and deduplicate by name
  const seen = new Set();
  const newProducts = products.filter(p => {
    const key = p.canonical_name.toLowerCase();
    if (existingNames.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  
  console.error(`New products to insert: ${newProducts.length}`);
  
  if (newProducts.length === 0) {
    console.log(JSON.stringify({ inserted: 0, skipped: products.length }));
    return;
  }
  
  // Transform for Supabase insert
  const rows = newProducts.map(p => {
    // Generate product_signature from brand + name
    const signature = `${p.brand}::${p.canonical_name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    return {
      product_signature: signature,
      canonical_name: p.canonical_name,
      brand: p.brand,
      product_type: p.product_type || 'Dietary Supplement',
      dosage_form: p.dosage_form,
      descriptions: p.description ? { scraped: p.description } : null,
      front_label_url: p.front_label_url,
      routing_metadata: {
        source: 'shopify_scrape',
        source_url: p.source_url,
        sku: p.sku,
        scraped_at: new Date().toISOString(),
        shopify_data: p.raw_data
      }
    };
  });
  
  // Insert in batches of 50
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/canonical_products?on_conflict=product_signature`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal,resolution=ignore-duplicates'
        },
        body: JSON.stringify(batch)
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`Batch insert failed: ${error}`);
    } else {
      inserted += batch.length;
      console.error(`Inserted batch ${Math.floor(i/50) + 1}: ${batch.length} products`);
    }
  }
  
  console.log(JSON.stringify({ 
    inserted, 
    skipped: products.length - newProducts.length,
    brand 
  }));
}

// Read from stdin or file
const inputFile = process.argv[2];
let input;

if (inputFile) {
  input = fs.readFileSync(inputFile, 'utf8');
} else {
  input = fs.readFileSync('/dev/stdin', 'utf8');
}

const products = JSON.parse(input);
insertProducts(products).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
