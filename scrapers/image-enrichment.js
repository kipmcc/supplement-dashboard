#!/usr/bin/env node
/**
 * Image Enrichment Pipeline
 * Finds and verifies front label images for products missing them
 * 
 * Sources: UPC databases, Google Images, brand sites
 * Verification: OpenAI Vision API
 */

import { createClient } from '@supabase/supabase-js';
import https from 'https';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';

// Config
const SUPABASE_URL = 'https://xijsvdhffiuxpepswnyb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjE3NTQ1NiwiZXhwIjoyMDgxNzUxNDU2fQ.1ZtXR6eQehlEkK_cgZu6GB1oERciPOedy6D2whwNEQ4';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STORAGE_BUCKET = 'supplement-images';
const BATCH_SIZE = parseInt(process.argv[2]) || 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Stats tracking
const stats = {
  processed: 0,
  found: 0,
  verified: 0,
  uploaded: 0,
  failed: 0,
  sources: {}
};

// Download image to buffer
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      timeout: 10000 
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadImage(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Search for product image using multiple strategies
async function findProductImage(product) {
  const { id, canonical_name, brand, upc, primary_barcode } = product;
  const barcode = upc || primary_barcode;
  
  const candidates = [];
  
  // Strategy 1: iHerb search (best quality images, no rate limit with scraping)
  try {
    const searchTerm = encodeURIComponent(`${brand} ${canonical_name}`.substring(0, 80));
    const iherbSearchUrl = `https://www.iherb.com/search?kw=${searchTerm}`;
    
    // Fetch search results page
    const response = await fetch(iherbSearchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    
    if (response.ok) {
      const html = await response.text();
      // Extract first product image from search results
      // iHerb uses data-src or src for lazy-loaded images
      const imgMatch = html.match(/class="product-image"[^>]*>[\s\S]*?<img[^>]*(?:data-src|src)="([^"]+)"/);
      if (imgMatch && imgMatch[1]) {
        let imgUrl = imgMatch[1];
        // Convert thumbnail to full size
        imgUrl = imgUrl.replace('/images/w/', '/images/l/').replace('/images/r/', '/images/l/');
        if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
        if (imgUrl.startsWith('http')) {
          candidates.push({ url: imgUrl, source: 'iherb_search' });
        }
      }
    }
  } catch (e) { /* continue */ }
  
  // Strategy 2: UPC Lookup APIs (limited to 100/day free)
  if (barcode && candidates.length === 0) {
    try {
      const upcUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;
      const response = await fetch(upcUrl);
      if (response.ok) {
        const data = await response.json();
        if (data.items?.[0]?.images?.length > 0) {
          candidates.push({ url: data.items[0].images[0], source: 'upcitemdb' });
        }
      }
    } catch (e) { /* continue */ }
  }
  
  // Strategy 3: Google Custom Search (if configured)
  // Placeholder for future implementation
  
  return candidates;
}

// Verify image is THE CORRECT supplement label using OpenAI Vision
async function verifyImage(imageBuffer, product) {
  if (!OPENAI_API_KEY) {
    console.log('  ⚠️ No OpenAI key - skipping verification');
    return false; // REJECT if no API key - we need verification
  }
  
  const base64Image = imageBuffer.toString('base64');
  const mimeType = 'image/jpeg';
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: `You are verifying supplement product images. I need to confirm this image is the EXACT CORRECT product.

Target Product:
- Brand: "${product.brand}"
- Product Name: "${product.canonical_name}"

Verification checklist:
1. Does the image show the brand name "${product.brand}" on the label?
2. Does the product name on the label match or closely match "${product.canonical_name}"?
3. Is this a front-facing product image (not a lifestyle photo, not a different product)?

Answer ONLY "MATCH" if ALL criteria are met.
Answer "NO_MATCH" if the brand is wrong, product name is wrong, or it's the wrong product.
Answer "UNCLEAR" if you cannot read the label clearly.`
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }],
        max_tokens: 20
      })
    });
    
    if (!response.ok) {
      console.log('  ⚠️ Vision API error:', response.status);
      return false;
    }
    
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.toUpperCase() || '';
    const isMatch = answer.includes('MATCH') && !answer.includes('NO_MATCH');
    
    if (!isMatch) {
      console.log(`  ❌ Verification failed: ${answer.substring(0, 50)}`);
    }
    
    return isMatch;
  } catch (e) {
    console.log('  ⚠️ Vision verification failed:', e.message);
    return false;
  }
}

// Upload image to Supabase Storage
async function uploadImage(imageBuffer, product, source) {
  const ext = 'webp'; // Will convert/standardize
  const storagePath = `enriched/front/${product.id}_front.${ext}`;
  
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, imageBuffer, {
        contentType: 'image/webp',
        upsert: true
      });
    
    if (error) throw error;
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);
    
    // Update product record
    await supabase
      .from('canonical_products')
      .update({
        front_label_url: urlData.publicUrl,
        front_label_storage_path: storagePath,
        updated_at: new Date().toISOString()
      })
      .eq('id', product.id);
    
    return urlData.publicUrl;
  } catch (e) {
    console.log('  ❌ Upload failed:', e.message);
    return null;
  }
}

// Process a single product
async function processProduct(product) {
  console.log(`\n📦 [${stats.processed + 1}] ${product.brand} - ${product.canonical_name?.substring(0, 50)}`);
  
  // Find candidate images
  const candidates = await findProductImage(product);
  
  if (candidates.length === 0) {
    console.log('  ❌ No image candidates found');
    stats.failed++;
    return false;
  }
  
  console.log(`  🔍 Found ${candidates.length} candidate(s)`);
  
  // Try each candidate
  for (const candidate of candidates) {
    try {
      console.log(`  ⬇️ Trying ${candidate.source}: ${candidate.url.substring(0, 60)}...`);
      
      // Download image
      const imageBuffer = await downloadImage(candidate.url);
      if (imageBuffer.length < 1000) {
        console.log('  ⚠️ Image too small, skipping');
        continue;
      }
      
      stats.found++;
      
      // Verify with vision
      const isValid = await verifyImage(imageBuffer, product);
      if (!isValid) {
        console.log('  ❌ Failed verification');
        continue;
      }
      
      stats.verified++;
      console.log('  ✅ Verified as supplement label');
      
      // Upload to storage
      const publicUrl = await uploadImage(imageBuffer, product, candidate.source);
      if (publicUrl) {
        stats.uploaded++;
        stats.sources[candidate.source] = (stats.sources[candidate.source] || 0) + 1;
        console.log('  ✅ Uploaded:', publicUrl.substring(0, 60));
        return true;
      }
    } catch (e) {
      console.log(`  ⚠️ Error: ${e.message}`);
    }
  }
  
  stats.failed++;
  return false;
}

// Main function
async function main() {
  console.log('🖼️ Image Enrichment Pipeline');
  console.log('═'.repeat(50));
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`OpenAI verification: ${OPENAI_API_KEY ? 'enabled' : 'DISABLED'}`);
  console.log('═'.repeat(50));
  
  // Get products missing front labels, prioritize those with UPCs
  const { data: products, error } = await supabase
    .from('canonical_products')
    .select('id, canonical_name, brand, upc, primary_barcode')
    .is('front_label_url', null)
    .not('upc', 'is', null)
    .order('source_count', { ascending: false })
    .limit(BATCH_SIZE);
  
  if (error || !products) {
    console.error('Failed to fetch products:', error);
    return;
  }
  
  console.log(`\nProcessing ${products.length} products with UPCs...\n`);
  
  for (const product of products) {
    stats.processed++;
    await processProduct(product);
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('📊 Summary:');
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Found candidates: ${stats.found}`);
  console.log(`   Verified: ${stats.verified}`);
  console.log(`   Uploaded: ${stats.uploaded}`);
  console.log(`   Failed: ${stats.failed}`);
  console.log(`   Sources: ${JSON.stringify(stats.sources)}`);
  
  // Update task progress
  await supabase
    .from('task_queue')
    .update({
      result_summary: `Processed ${stats.processed}, uploaded ${stats.uploaded}`,
      products_added: stats.uploaded,
      updated_at: new Date().toISOString()
    })
    .eq('task_key', 'scrape_labels');
}

main().catch(console.error);
