# Dashboard Tab Guide — For AI Agents

*How to read, interpret, and operate the main Dashboard tab.*

*Last updated: 2026-02-14*

---

## Purpose

The Dashboard tab is the **read-only overview** of the entire supplement database. It shows:
- Database health metrics (product counts, brand counts, source counts)
- GVM Fleet scraping status
- Data gap trends over time (chart)
- Field completeness percentages
- AviScore distribution
- Certification coverage
- Top brands by quality metrics
- Research pipeline estimates
- Brand discovery queue (static)
- Peptide coverage (static)
- Category coverage gaps (static)
- Feature roadmap (static)
- Recent activity feed

---

## UI Layout

### Top Metrics Row
| Card | Source | DB Query |
|------|--------|----------|
| Canonical Products | `canonical_products` count | `SELECT count(*) FROM canonical_products` |
| Product Sources | `product_sources` count | `SELECT count(*) FROM product_sources` |
| Unique Brands | RPC function | `SELECT get_unique_brand_count()` |
| GVM Fleet | `gvm_fleet_status` table | `SELECT * FROM gvm_fleet_status ORDER BY vm_name` |

### Data Gap Trends (Chart.js line chart)
- Tracks 6 metrics over time via `metrics_history` table
- Captures daily snapshots automatically on page load
- Metrics: `missing_upc`, `missing_facts`, `missing_front_label`, `missing_back_label`, `missing_aviscore`, `unmatched_discovered`

### Field Completeness
Shows percentage of `canonical_products` with non-null values for:
`upc`, `supplement_facts`, `front_label_url`, `back_label_url`, `certifications`, `dosage_form`

### AviScore Distribution
Doughnut chart via RPC: `SELECT get_aviscore_distribution()`
Grades: A (8-10), B (6-8), C (4-6), D (2-4), F (0-2), No Score

### Certification Coverage
Reads from `product_quality_scores` table for:
`third_party_tested`, `nsf_certified`, `usp_verified`, `nsf_certified_for_sport`, `certified_non_gmo`, `usda_organic`, `certified_vegan`, `certified_gluten_free`

### Top Brands Table
Fetches all `canonical_products` (paginated in batches of 1000), joins with `product_quality_scores`, aggregates by brand. Shows top 15 by product count.

### Static Sections (hardcoded in HTML)
These sections don't query the database — they're manually maintained:
- Research Pipeline (brand counts, peptide counts)
- Brand Discovery Queue (priority lists)
- Peptide Coverage (compound categories)
- Category Coverage Gaps (target vs actual)
- Feature Roadmap (phases 1-4)

---

## Key Database Tables

### `canonical_products`
Main product catalog (~35K rows).
```sql
-- Key columns for dashboard metrics
SELECT id, canonical_name, brand, upc, supplement_facts,
       front_label_url, back_label_url, certifications,
       dosage_form, routing_metadata, created_at
FROM canonical_products;
```

### `metrics_history`
Daily metric snapshots for the trend chart.
```sql
-- Schema
-- captured_at (timestamptz), metric_name (text), metric_value (numeric)

-- Query historical data
SELECT captured_at, metric_name, metric_value
FROM metrics_history
ORDER BY captured_at ASC;
```

### `gvm_fleet_status`
VM scraping fleet status cards.
```sql
-- Key columns
SELECT vm_name, status, brand, products_scraped, images_downloaded,
       errors, skipped, elapsed, search_list_size, last_product_title, updated_at
FROM gvm_fleet_status
ORDER BY vm_name;
```

### `product_quality_scores`
Certification and quality data joined to products.
```sql
SELECT product_id, third_party_tested, nsf_certified, usp_verified,
       nsf_certified_for_sport, certified_non_gmo, usda_organic,
       certified_vegan, certified_gluten_free
FROM product_quality_scores;
```

---

## Metrics Snapshot System

The dashboard auto-captures a metrics snapshot once per day on page load:

1. Calls `getCurrentMetrics()` — counts null fields across `canonical_products`
2. Checks if a snapshot exists for today in `metrics_history`
3. If not, inserts 6 rows (one per metric) with `captured_at = NOW()`
4. The trend chart always overwrites today's data with live values

### Capturing a snapshot manually (SQL)
```sql
-- Example: record current missing_upc count
INSERT INTO metrics_history (captured_at, metric_name, metric_value)
VALUES (NOW(), 'missing_upc', (
  SELECT COUNT(*) FROM canonical_products WHERE upc IS NULL
));
```

---

## GVM Fleet Panel

The fleet status card is clickable — expands to show per-VM detail cards.
- Auto-refreshes every 15 minutes when expanded
- Shows: products scraped, images downloaded, errors, skipped, elapsed time, progress bar
- Status types: `running`, `stopped`, `error`, `complete`

---

## What Agents Can Do

### Read-only operations (no side effects)
- Load dashboard metrics to report on database health
- Check gap trends to recommend scraping priorities
- Review fleet status to monitor active scrapers

### Write operations
- Insert metrics snapshots: `INSERT INTO metrics_history ...`
- Update GVM fleet status: `UPDATE gvm_fleet_status SET ... WHERE vm_name = '...'`

### Useful queries for agents
```sql
-- What are the biggest gaps right now?
SELECT 'missing_upc' as gap, COUNT(*) FROM canonical_products WHERE upc IS NULL
UNION ALL
SELECT 'missing_facts', COUNT(*) FROM canonical_products WHERE supplement_facts IS NULL
UNION ALL
SELECT 'missing_front_label', COUNT(*) FROM canonical_products WHERE front_label_url IS NULL
ORDER BY count DESC;

-- How many products were added in the last 7 days?
SELECT COUNT(*) FROM canonical_products
WHERE created_at > NOW() - INTERVAL '7 days';

-- Fleet progress summary
SELECT vm_name, status, products_scraped, search_list_size,
       ROUND(100.0 * products_scraped / NULLIF(search_list_size, 0), 1) as pct
FROM gvm_fleet_status ORDER BY vm_name;
```

---

## Refreshing Data

- `window.refreshAll()` — reloads all dashboard sections
- Individual loaders: `loadOverviewMetrics()`, `loadCoverageMetrics()`, `loadCertificationCoverage()`, `loadTopBrands()`, `loadDataGaps()`, `loadRecentActivity()`
- Fleet: `loadFleetStatus()` — called within `loadOverviewMetrics()`
