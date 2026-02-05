-- Gap Tracking Tables and Functions
-- Tracks data completeness hour-over-hour and day-over-day
-- Created: 2026-01-30

-- ============================================
-- TABLES
-- ============================================

-- Hourly snapshots (ephemeral, current day only)
CREATE TABLE IF NOT EXISTS gap_snapshots_hourly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_hour TIMESTAMPTZ NOT NULL,
  
  -- Aggregate metrics
  total_products INTEGER NOT NULL DEFAULT 0,
  products_with_full_data INTEGER NOT NULL DEFAULT 0,
  completeness_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  
  -- Gap breakdown by category
  gaps_by_category JSONB NOT NULL DEFAULT '{}',
  
  -- Top gaps for quick action
  top_gaps JSONB NOT NULL DEFAULT '[]',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT gap_hourly_unique_hour UNIQUE(snapshot_hour)
);

CREATE INDEX IF NOT EXISTS idx_gap_hourly_time ON gap_snapshots_hourly(snapshot_hour DESC);

-- Daily snapshots (permanent)
CREATE TABLE IF NOT EXISTS gap_snapshots_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  
  -- End-of-day metrics
  total_products INTEGER NOT NULL DEFAULT 0,
  products_with_full_data INTEGER NOT NULL DEFAULT 0,
  completeness_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  
  -- Day's progress
  start_completeness_pct NUMERIC(5,2),
  end_completeness_pct NUMERIC(5,2),
  delta_pct NUMERIC(5,2),
  
  -- Gap breakdown
  gaps_by_category JSONB NOT NULL DEFAULT '{}',
  top_gaps JSONB NOT NULL DEFAULT '[]',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT gap_daily_unique_date UNIQUE(snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_gap_daily_date ON gap_snapshots_daily(snapshot_date DESC);

-- Data quality rules (what fields are required)
CREATE TABLE IF NOT EXISTS data_quality_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(100) NOT NULL,
  required_fields JSONB NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT quality_rules_unique_category UNIQUE(category)
);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Calculate current gaps across all canonical products
CREATE OR REPLACE FUNCTION calculate_current_gaps()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  WITH product_completeness AS (
    SELECT 
      cp.id,
      COALESCE(cp.primary_supplement_id, 'uncategorized') as category,
      -- A product is complete if it has: name, brand, and supplement_facts with nutrients
      CASE 
        WHEN cp.canonical_name IS NOT NULL 
         AND cp.brand IS NOT NULL 
         AND cp.supplement_facts IS NOT NULL 
         AND cp.supplement_facts->'nutrients' IS NOT NULL
         AND jsonb_array_length(COALESCE(cp.supplement_facts->'nutrients', '[]'::jsonb)) > 0
        THEN true 
        ELSE false 
      END as is_complete,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN cp.canonical_name IS NULL THEN 'canonical_name' END,
        CASE WHEN cp.brand IS NULL THEN 'brand' END,
        CASE WHEN cp.supplement_facts IS NULL OR cp.supplement_facts->'nutrients' IS NULL 
             OR jsonb_array_length(COALESCE(cp.supplement_facts->'nutrients', '[]'::jsonb)) = 0 
             THEN 'supplement_facts' END
      ], NULL) as missing_fields
    FROM canonical_products cp
  ),
  category_stats AS (
    SELECT 
      category,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_complete) as complete,
      ROUND(100.0 * COUNT(*) FILTER (WHERE is_complete) / NULLIF(COUNT(*), 0), 2) as pct
    FROM product_completeness
    GROUP BY category
  ),
  top_incomplete AS (
    SELECT 
      category,
      100 - COALESCE(pct, 0) as gap_pct
    FROM category_stats
    WHERE pct < 100
    ORDER BY total DESC, gap_pct DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'total_products', (SELECT COUNT(*) FROM product_completeness),
    'products_complete', (SELECT COUNT(*) FROM product_completeness WHERE is_complete),
    'completeness_pct', (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE is_complete) / NULLIF(COUNT(*), 0), 2) FROM product_completeness),
    'gaps_by_category', (SELECT COALESCE(jsonb_object_agg(category, jsonb_build_object('total', total, 'complete', complete, 'pct', pct)), '{}'::jsonb) FROM category_stats),
    'top_gaps', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'gap_pct', gap_pct)), '[]'::jsonb) FROM top_incomplete)
  ) INTO result;
  
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Record hourly gap snapshot
CREATE OR REPLACE FUNCTION record_hourly_gap_snapshot()
RETURNS JSONB AS $$
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
    gaps_by_category,
    top_gaps
  ) VALUES (
    current_hour,
    COALESCE((gaps->>'total_products')::INTEGER, 0),
    COALESCE((gaps->>'products_complete')::INTEGER, 0),
    COALESCE((gaps->>'completeness_pct')::NUMERIC, 0),
    COALESCE(gaps->'gaps_by_category', '{}'::jsonb),
    COALESCE(gaps->'top_gaps', '[]'::jsonb)
  )
  ON CONFLICT (snapshot_hour) DO UPDATE SET
    total_products = EXCLUDED.total_products,
    products_with_full_data = EXCLUDED.products_with_full_data,
    completeness_pct = EXCLUDED.completeness_pct,
    gaps_by_category = EXCLUDED.gaps_by_category,
    top_gaps = EXCLUDED.top_gaps;
    
  RETURN gaps;
END;
$$ LANGUAGE plpgsql;

-- Roll up daily gaps (run at midnight CT)
CREATE OR REPLACE FUNCTION rollup_daily_gaps()
RETURNS void AS $$
DECLARE
  yesterday DATE;
  first_pct NUMERIC;
  last_pct NUMERIC;
  last_snapshot RECORD;
BEGIN
  yesterday := (NOW() AT TIME ZONE 'America/Chicago')::DATE - 1;
  
  -- Get first completeness for the day
  SELECT completeness_pct INTO first_pct
  FROM gap_snapshots_hourly
  WHERE (snapshot_hour AT TIME ZONE 'America/Chicago')::DATE = yesterday
  ORDER BY snapshot_hour ASC 
  LIMIT 1;
  
  -- Get last snapshot for the day
  SELECT * INTO last_snapshot
  FROM gap_snapshots_hourly
  WHERE (snapshot_hour AT TIME ZONE 'America/Chicago')::DATE = yesterday
  ORDER BY snapshot_hour DESC 
  LIMIT 1;
  
  IF last_snapshot IS NULL THEN
    RETURN; -- No data for yesterday
  END IF;
  
  last_pct := last_snapshot.completeness_pct;
  
  -- Insert daily record
  INSERT INTO gap_snapshots_daily (
    snapshot_date,
    total_products,
    products_with_full_data,
    completeness_pct,
    start_completeness_pct,
    end_completeness_pct,
    delta_pct,
    gaps_by_category,
    top_gaps
  ) VALUES (
    yesterday,
    last_snapshot.total_products,
    last_snapshot.products_with_full_data,
    last_snapshot.completeness_pct,
    first_pct,
    last_pct,
    last_pct - COALESCE(first_pct, last_pct),
    last_snapshot.gaps_by_category,
    last_snapshot.top_gaps
  )
  ON CONFLICT (snapshot_date) DO NOTHING;
  
  -- Purge old hourly data (keep only today)
  DELETE FROM gap_snapshots_hourly 
  WHERE (snapshot_hour AT TIME ZONE 'America/Chicago')::DATE < (NOW() AT TIME ZONE 'America/Chicago')::DATE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA
-- ============================================

-- Default quality rules (categories match supplement_categories.canonical_id)
INSERT INTO data_quality_rules (category, required_fields, weight) VALUES
  ('_default', '["canonical_name", "brand", "supplement_facts"]', 1),
  ('vitamin_d3', '["canonical_name", "brand", "supplement_facts", "serving_size"]', 2),
  ('magnesium', '["canonical_name", "brand", "supplement_facts", "serving_size"]', 2),
  ('omega_3_fatty_acids', '["canonical_name", "brand", "supplement_facts", "serving_size"]', 2)
ON CONFLICT (category) DO NOTHING;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE gap_snapshots_hourly IS 'Ephemeral hourly gap snapshots for current day tracking';
COMMENT ON TABLE gap_snapshots_daily IS 'Permanent daily gap snapshots for trend analysis';
COMMENT ON TABLE data_quality_rules IS 'Defines required fields per category for completeness scoring';
COMMENT ON FUNCTION calculate_current_gaps() IS 'Returns current gap analysis as JSONB';
COMMENT ON FUNCTION record_hourly_gap_snapshot() IS 'Records current gaps to hourly table (call hourly)';
COMMENT ON FUNCTION rollup_daily_gaps() IS 'Rolls up hourly to daily and purges old hourly (call at midnight CT)';
