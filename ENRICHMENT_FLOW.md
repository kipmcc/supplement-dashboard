# Grok Web Search Enrichment Pipeline — Flow Diagram

*Last updated: 2026-02-10 22:30 CST*
*Script: `/Users/aviado1/clawd/fullscript-scraper/src/grokLabelRunner.js`*

---

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    OVERNIGHT BATCH RUNNER                     │
│              grokLabelRunner.js (PID tracked)                 │
│                                                               │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐               │
│   │ Batch 1 │────▶│ Batch 2 │────▶│ Batch N │──▶ Summary    │
│   │  (50)   │     │  (50)   │     │  (50)   │               │
│   └─────────┘     └─────────┘     └─────────┘               │
│       │               │               │                       │
│     30s pause       30s pause       30s pause                 │
│                                                               │
│   Progress → /tmp/grok-overnight-progress.json                │
│   Full log → /tmp/grok-overnight.log                          │
└─────────────────────────────────────────────────────────────┘
```

## Per-Product Pipeline (Inside Each Batch)

```
┌──────────────────────────────────────────────────────────────────┐
│  CANDIDATE SELECTION                                              │
│                                                                   │
│  Supabase query:                                                  │
│    canonical_products WHERE                                       │
│      brand IS NOT NULL                                            │
│      AND canonical_name IS NOT NULL                               │
│      AND upc IS NOT NULL                                          │
│      AND front_label_url IS NULL                                  │
│    ORDER BY: priority brands first (45 brands), then others       │
│    LIMIT: 50 per batch                                            │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1: GROK WEB SEARCH                                         │
│                                                                   │
│  API: POST https://api.x.ai/v1/responses                         │
│  Model: grok-4-1-fast-reasoning                                   │
│  Tool: web_search (server-side, Grok executes)                    │
│  Timeout: 60s                                                     │
│                                                                   │
│  Prompt: "Find the product page URL for this supplement           │
│           on iHerb, Amazon, or the brand's official website.      │
│           Return ONLY the URL.                                    │
│           Brand: {brand} / Product: {name} / UPC: {upc}"         │
│                                                                   │
│  Avg: 10-11 web searches, ~$0.50-0.60, ~20-30s                   │
│                                                                   │
│  Output: Product page URL + citations                             │
│                                                                   │
│  Blacklist check: kusoglife.com, suppleroo.com, supp.co,          │
│                   biotus.ua, desertcart.com                       │
└──────────────────────┬──────────────────────────┬────────────────┘
                       │ URL found                 │ No URL / blacklisted
                       ▼                           ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐
│  STEP 2: SCRAPE PAGE IMAGES  │    │  STEP 3: FALLBACK SEARCHES   │
│                               │    │                               │
│  HTTP fetch product page      │    │  A) iHerb Direct:             │
│  Parse HTML for images:       │    │     GET iherb.com/search?kw=  │
│                               │    │     Extract cloudinary URL     │
│  Priority order:              │    │     Upgrade to /l/ (large)     │
│  1. og:image meta tag         │    │                               │
│  2. Amazon hi-res (_SL1500_)  │    │  B) Amazon Direct:            │
│  3. iHerb cloudinary (/l/)    │    │     Search by UPC first       │
│  4. Shopify CDN (full size)   │    │     Then brand+name           │
│  5. Generic product images    │    │     Get /dp/ page             │
│                               │    │     Extract _SL1500_ image    │
│  Size upgrades applied:       │    │                               │
│  • Amazon → _AC_SL1500_       │    │  ⚠️ Amazon direct has issues: │
│  • iHerb → /l/ (large)       │    │  scraping without browser     │
│  • Shopify → remove _NxN      │    │  sometimes returns promo      │
│                               │    │  overlay instead of product   │
│  Reject if < 5KB              │    │                               │
└──────────┬───────────────────┘    └──────────┬───────────────────┘
           │                                    │
           └────────────┬───────────────────────┘
                        │ Image buffer (>5KB)
                        │ OR ❌ No image → log failure, skip
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 4: VISION OCR VERIFICATION                                  │
│                                                                   │
│  API: Google Vision TEXT_DETECTION                                 │
│  Input: PNG buffer (converted via sharp)                          │
│                                                                   │
│  Checks:                                                          │
│  ┌─────────────────────────────────────────┐                     │
│  │ 1. Brand match: any brand word (>2 char) │                     │
│  │    found in OCR text?                     │                     │
│  │                                           │                     │
│  │ 2. Name match: ≥1 significant name word   │                     │
│  │    found in OCR text?                     │                     │
│  │    (excludes: with, from, plus, caps,     │                     │
│  │     tablets, softgels, supplement, etc.)   │                     │
│  │                                           │                     │
│  │ 3. Non-supplement scan: check for         │                     │
│  │    pet/dog/cat/shampoo/lotion keywords    │                     │
│  └─────────────────────────────────────────┘                     │
│                                                                   │
│  PASS = brand match AND ≥1 name word                              │
│  FAIL = no brand OR 0 name words → skip                           │
│  FLAG = non-supplement keywords → log for review                  │
└──────────────────────┬──────────────────────────┬────────────────┘
                       │ ✅ Verified                │ ❌ Mismatch
                       ▼                           │ → log, skip
┌──────────────────────────────────────────────────────────────────┐
│  STEP 5: IMAGE PROCESSING                                        │
│                                                                   │
│  sharp library:                                                   │
│  • Convert any format → WebP                                      │
│  • Quality: 92 (high fidelity)                                    │
│  • Preserve original resolution                                   │
│  • Capture dimensions metadata                                    │
│                                                                   │
│  Target: 60-250KB stored images (700-1500px)                      │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 6: SUPABASE STORAGE UPLOAD                                  │
│                                                                   │
│  Bucket: supplement-images                                        │
│  Path:   hunted/grok-search/{product_uuid}_front.webp             │
│  Type:   image/webp                                               │
│  Upsert: true (replaces if exists)                                │
│  Cache:  3600s                                                    │
│                                                                   │
│  Returns: public_url, storage_path, size                          │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 7: DATABASE UPDATE                                          │
│                                                                   │
│  UPDATE canonical_products SET                                    │
│    front_label_url = '{supabase_public_url}',                     │
│    front_label_storage_path = 'hunted/grok-search/{id}_front.webp'│
│    updated_at = NOW()                                             │
│  WHERE id = '{product_uuid}';                                     │
│                                                                   │
│  ✅ SAVED — product now has front label image                     │
└──────────────────────────────────────────────────────────────────┘
```

## Tracking & Monitoring

```
┌─────────────────────────────────────────────────────────┐
│  CUMULATIVE STATS (saved after each batch)               │
│                                                          │
│  /tmp/grok-overnight-progress.json                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ {                                                   │  │
│  │   batchesCompleted, total, saved, mismatch,         │  │
│  │   noImage, noUrl, errors,                           │  │
│  │   nonSupplements: [{id, brand, name, ocrSnippet}],  │  │
│  │   totalCostUSD, totalTokens, totalSearches,         │  │
│  │   avgImageSizeKB, saveRate,                         │  │
│  │   savedProducts: [{id, brand, name, sizeKB, src}],  │  │
│  │   failedProducts: [{id, brand, name, reason}]       │  │
│  │ }                                                   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Monitor:                                                │
│    ps -p {PID}                                           │
│    cat /tmp/grok-overnight-progress.json                 │
│    grep -c SAVED /tmp/grok-overnight.log                 │
│    tail -20 /tmp/grok-overnight.log                      │
└─────────────────────────────────────────────────────────┘
```

## Failure Categories

| Category | Cause | Potential Fix |
|----------|-------|---------------|
| **No URL from Grok** | Product too obscure for web search | Try different search terms |
| **Blacklisted domain** | Grok found low-quality aggregator | Expand blacklist as needed |
| **No image on page** | JS-rendered site, or no product images in HTML | Browser scraping (Camoufox) |
| **Image too small** | Thumbnail/icon (<5KB) | Upgrade URL patterns |
| **Vision mismatch: no-brand** | OCR couldn't read brand on label | Relax brand matching |
| **Vision mismatch: name=0/N** | Wrong product image scraped | Better image selection |
| **Vision: no-ocr-text** | Image format issue or blank image | Convert to PNG before OCR |
| **Amazon promo overlay** | Direct Amazon scrape returns ad page | Need browser for Amazon |
| **Non-supplement flagged** | Pet/cosmetic/food product in DB | Review and delete from DB |

## Performance (v2 Test Results)

| Metric | Value |
|--------|-------|
| Save rate (priority brands) | **70%** |
| Avg time per product | 29s |
| Avg cost per product | $0.57-0.62 |
| Avg image size | 123KB |
| Image dimensions | 700-1500px |
| Grok searches per product | 10-11 avg |

## Known Issues / TODO

- [ ] **Amazon direct fallback unreliable** — sometimes returns wrong product entirely (e.g., brake pads instead of supplements). Needs browser-based scraping or better URL verification.
- [ ] **JS-rendered brand sites** — americanhealthus.com and similar return empty HTML. Need headless browser or Shopify API.
- [ ] **iHerb direct search** — HTTP scraping hasn't been yielding results (may need cookies/JS). Browser-based iHerb search works better.
- [ ] **image_metadata column** — exists in DB but Supabase client cache doesn't recognize it. Not critical (metadata stored in progress JSON instead).
- [ ] **Cost optimization** — could batch multiple products per Grok request to reduce overhead.

---

*This diagram reflects the pipeline as of 2026-02-10 22:00 CST.*
