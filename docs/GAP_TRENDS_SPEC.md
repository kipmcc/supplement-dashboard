# Gap Trends - Data Model & Implementation Plan

## Purpose

Track supplement/nutrient data completeness with:
- **Hourly resolution** during the day (watch convergence in real-time)
- **Daily rollups** for trend tracking (are we closing gaps day-over-day?)

**Dual use:**
1. Dashboard visibility - see the database converging toward completeness
2. Operational tool - tells Jeff what to scrape/fix next

---

## Data Model

### 1. `gap_snapshots_hourly`

Current day's hourly snapshots. Ephemeral - purged after daily rollup.

```sql
CREATE TABLE IF NOT EXISTS gap_snapshots_hourly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_hour TIMESTAMPTZ NOT NULL,
  
  -- Aggregate metrics
  total_products INTEGER NOT NULL DEFAULT 0,
  products_with_full_data INTEGER NOT NULL DEFAULT 0,
  completeness_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  
  -- Gap breakdown by category
  gaps_by_category JSONB NOT NULL DEFAULT '{}',
  -- {"vitamin_d": {"total": 50, "complete": 35, "missing_fields": ["serving_size", "price"]}, ...}
  
  -- Top gaps for quick action
  top_gaps JSONB NOT NULL DEFAULT '[]',
  -- [{"category": "vitamin_d", "gap_pct": 30, "missing": ["price", "image"]}, ...]
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT gap_hourly_unique_hour UNIQUE(snapshot_hour)
);

CREATE INDEX IF NOT EXISTS idx_gap_hourly_time ON gap_snapshots_hourly(snapshot_hour DESC);
```

### 2. `gap_snapshots_daily`

Permanent daily records. One row per day, starting from today.

```sql
CREATE TABLE IF NOT EXISTS gap_snapshots_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  
  -- End-of-day metrics
  total_products INTEGER NOT NULL DEFAULT 0,
  products_with_full_data INTEGER NOT NULL DEFAULT 0,
  completeness_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  
  -- Day's progress
  start_completeness_pct NUMERIC(5,2),  -- first hour of day
  end_completeness_pct NUMERIC(5,2),    -- last hour of day
  delta_pct NUMERIC(5,2),               -- improvement (positive = good)
  
  -- Gap breakdown
  gaps_by_category JSONB NOT NULL DEFAULT '{}',
  top_gaps JSONB NOT NULL DEFAULT '[]',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT gap_daily_unique_date UNIQUE(snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_gap_daily_date ON gap_snapshots_daily(snapshot_date DESC);
```

### 3. `data_quality_rules`

Defines what "complete" means for each product category.

```sql
CREATE TABLE IF NOT EXISTS data_quality_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(100) NOT NULL,       -- "vitamin_d", "magnesium", etc. or "_default"
  required_fields JSONB NOT NULL,       -- ["name", "brand", "serving_size", "amount", "unit", "price"]
  weight INTEGER NOT NULL DEFAULT 1,    -- importance for prioritization
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT quality_rules_unique_category UNIQUE(category)
);

-- Default rules
INSERT INTO data_quality_rules (category, required_fields, weight) VALUES
  ('_default', '["name", "brand", "serving_size", "price"]', 1)
ON CONFLICT (category) DO NOTHING;
```

---

## Implementation

### Phase 1: Tables + Gap Calculator

**Migration: `001_gap_tracking_tables.sql`**

Creates all three tables above.

**Function: `calculate_current_gaps()`**

```sql
CREATE OR REPLACE FUNCTION calculate_current_gaps()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  -- Analyze products table against quality rules
  -- Return current gap state
  WITH product_completeness AS (
    SELECT 
      p.id,
      p.category,
      CASE 
        WHEN p.name IS NOT NULL 
         AND p.brand IS NOT NULL 
         AND p.serving_size IS NOT NULL 
         AND p.price IS NOT NULL 
        THEN true 
        ELSE false 
      END as is_complete,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN p.name IS NULL THEN 'name' END,
        CASE WHEN p.brand IS NULL THEN 'brand' END,
        CASE WHEN p.serving_size IS NULL THEN 'serving_size' END,
        CASE WHEN p.price IS NULL THEN 'price' END
      ], NULL) as missing_fields
    FROM products p
  )
  SELECT jsonb_build_object(
    'total_products', COUNT(*),
    'products_complete', COUNT(*) FILTER (WHERE is_complete),
    'completeness_pct', ROUND(100.0 * COUNT(*) FILTER (WHERE is_complete) / NULLIF(COUNT(*), 0), 2),
    'gaps_by_category', (
      SELECT jsonb_object_agg(category, cat_stats)
      FROM (
        SELECT 
          category,
          jsonb_build_object(
            'total', COUNT(*),
            'complete', COUNT(*) FILTER (WHERE is_complete),
            'pct', ROUND(100.0 * COUNT(*) FILTER (WHERE is_complete) / NULLIF(COUNT(*), 0), 2)
          ) as cat_stats
        FROM product_completeness
        GROUP BY category
      ) cats
    )
  ) INTO result
  FROM product_completeness;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;
```

### Phase 2: Snapshot Jobs

**Hourly snapshot** (call from cron or on-demand):

```sql
CREATE OR REPLACE FUNCTION record_hourly_gap_snapshot()
RETURNS void AS $$
DECLARE
  gaps JSONB;
  current_hour TIMESTAMPTZ;
BEGIN
  current_hour := DATE_TRUNC('hour', NOW() AT TIME ZONE 'America/Chicago');
  gaps := calculate_current_gaps();
  
  INSERT INTO gap_snapshots_hourly (
    snapshot_hour,
    total_products,
    products_with_full_data,
    completeness_pct,
    gaps_by_category
  ) VALUES (
    current_hour,
    (gaps->>'total_products')::INTEGER,
    (gaps->>'products_complete')::INTEGER,
    (gaps->>'completeness_pct')::NUMERIC,
    gaps->'gaps_by_category'
  )
  ON CONFLICT (snapshot_hour) DO UPDATE SET
    total_products = EXCLUDED.total_products,
    products_with_full_data = EXCLUDED.products_with_full_data,
    completeness_pct = EXCLUDED.completeness_pct,
    gaps_by_category = EXCLUDED.gaps_by_category;
END;
$$ LANGUAGE plpgsql;
```

**Daily rollup** (run at midnight CT):

```sql
CREATE OR REPLACE FUNCTION rollup_daily_gaps()
RETURNS void AS $$
DECLARE
  yesterday DATE;
  first_pct NUMERIC;
  last_pct NUMERIC;
BEGIN
  yesterday := (NOW() AT TIME ZONE 'America/Chicago')::DATE - 1;
  
  -- Get first and last completeness for the day
  SELECT completeness_pct INTO first_pct
  FROM gap_snapshots_hourly
  WHERE snapshot_hour::DATE = yesterday
  ORDER BY snapshot_hour ASC LIMIT 1;
  
  SELECT completeness_pct INTO last_pct
  FROM gap_snapshots_hourly
  WHERE snapshot_hour::DATE = yesterday
  ORDER BY snapshot_hour DESC LIMIT 1;
  
  -- Insert daily record
  INSERT INTO gap_snapshots_daily (
    snapshot_date,
    total_products,
    products_with_full_data,
    completeness_pct,
    start_completeness_pct,
    end_completeness_pct,
    delta_pct,
    gaps_by_category
  )
  SELECT 
    yesterday,
    h.total_products,
    h.products_with_full_data,
    h.completeness_pct,
    first_pct,
    last_pct,
    last_pct - first_pct,
    h.gaps_by_category
  FROM gap_snapshots_hourly h
  WHERE h.snapshot_hour::DATE = yesterday
  ORDER BY h.snapshot_hour DESC
  LIMIT 1
  ON CONFLICT (snapshot_date) DO NOTHING;
  
  -- Purge old hourly data (keep only today)
  DELETE FROM gap_snapshots_hourly 
  WHERE snapshot_hour < DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Chicago');
END;
$$ LANGUAGE plpgsql;
```

---

## API Endpoints

```
GET /api/gaps/current      → Latest gap state
GET /api/gaps/today        → Hourly snapshots for today
GET /api/gaps/history      → Daily snapshots (last 30 days)
GET /api/gaps/priorities   → Top gaps to fix (for Jeff)
```

---

## Cron Schedule

| Job | Schedule | Function |
|-----|----------|----------|
| Hourly snapshot | Every hour | `record_hourly_gap_snapshot()` |
| Daily rollup | 00:05 CT | `rollup_daily_gaps()` |

---

## Next Actions

1. Create migrations
2. Seed quality rules for our categories
3. Run initial gap calculation
4. Add to dashboard UI
