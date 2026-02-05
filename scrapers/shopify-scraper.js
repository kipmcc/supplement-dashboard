#!/usr/bin/env node
/**
 * Shopify Product Scraper for Supplement Database
 * Scrapes products from Shopify stores and outputs JSON for Supabase import
 */

const STORES = {
  'ancestral-supplements': {
    name: 'Ancestral Supplements',
    url: 'https://ancestralsupplements.com',
    brand: 'Ancestral Supplements'
  },
  'heart-and-soil': {
    name: 'Heart & Soil',
    url: 'https://heartandsoil.co',
    brand: 'Heart & Soil'
  },
  'renue-by-science': {
    name: 'Renue By Science',
    url: 'https://rfrequency.com', // Their actual Shopify domain
    brand: 'Renue By Science'
  }
};

async function fetchAllProducts(storeUrl) {
  const products = [];
  let page = 1;
  
  while (true) {
    const url = `${storeUrl}/products.json?limit=250&page=${page}`;
    console.error(`Fetching ${url}...`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Error: ${response.status}`);
      break;
    }
    
    const data = await response.json();
    if (!data.products || data.products.length === 0) break;
    
    products.push(...data.products);
    console.error(`  Got ${data.products.length} products (total: ${products.length})`);
    
    if (data.products.length < 250) break;
    page++;
  }
  
  return products;
}

function transformProduct(product, brand, storeUrl) {
  const variant = product.variants?.[0] || {};
  const image = product.images?.[0];
  
  // Skip bundles, gift cards, subscriptions
  const skipTags = ['bundle', 'gift', 'subscription', 'sample', 'merch', 'b2g1', 'b3g3', 'buy 2', 'buy 3'];
  const titleLower = product.title.toLowerCase();
  const hasSkipTag = skipTags.some(tag => titleLower.includes(tag) || product.tags?.some(t => t.toLowerCase().includes(tag)));
  
  if (hasSkipTag) {
    return null;
  }
  
  // Extract dosage form from title/tags
  let dosageForm = 'Capsule';
  if (titleLower.includes('powder') || titleLower.includes('jar')) dosageForm = 'Powder';
  if (titleLower.includes('liquid') || titleLower.includes('drops')) dosageForm = 'Liquid';
  if (titleLower.includes('softgel')) dosageForm = 'Softgel';
  if (titleLower.includes('gummies') || titleLower.includes('gummy')) dosageForm = 'Gummy';
  
  // Clean up title
  let cleanTitle = product.title
    .replace(/\s*-\s*(Buy|Subscribe).*$/i, '')
    .replace(/\s*\(.*\)$/, '')
    .trim();
  
  return {
    canonical_name: cleanTitle,
    brand: brand,
    product_type: product.product_type || 'Dietary Supplement',
    dosage_form: dosageForm,
    description: product.body_html?.replace(/<[^>]*>/g, '').substring(0, 500) || null,
    front_label_url: image?.src || null,
    sku: variant.sku || null,
    price_cents: variant.price ? Math.round(parseFloat(variant.price) * 100) : null,
    source_url: `${storeUrl}/products/${product.handle}`,
    source_name: 'shopify_scrape',
    raw_data: {
      shopify_id: product.id,
      shopify_handle: product.handle,
      tags: product.tags,
      variants: product.variants?.map(v => ({
        id: v.id,
        sku: v.sku,
        price: v.price,
        title: v.title
      }))
    }
  };
}

async function scrapeStore(storeKey) {
  const store = STORES[storeKey];
  if (!store) {
    console.error(`Unknown store: ${storeKey}`);
    console.error(`Available stores: ${Object.keys(STORES).join(', ')}`);
    process.exit(1);
  }
  
  console.error(`\n=== Scraping ${store.name} ===`);
  console.error(`URL: ${store.url}`);
  
  const rawProducts = await fetchAllProducts(store.url);
  console.error(`\nRaw products fetched: ${rawProducts.length}`);
  
  const products = rawProducts
    .map(p => transformProduct(p, store.brand, store.url))
    .filter(p => p !== null);
  
  console.error(`Products after filtering: ${products.length}`);
  
  return products;
}

// Main
const storeKey = process.argv[2];
if (!storeKey) {
  console.error('Usage: node shopify-scraper.js <store-key>');
  console.error(`Available stores: ${Object.keys(STORES).join(', ')}`);
  process.exit(1);
}

scrapeStore(storeKey).then(products => {
  // Output JSON to stdout
  console.log(JSON.stringify(products, null, 2));
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
