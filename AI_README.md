# AI Operations Manual — Supplement Dashboard

*Last updated: 2026-02-10 06:05 CST by Jeff*
*This file is the single source of truth for AI agents operating on this system.*

---

## 🎯 Quick Start

**Dashboard URL:** https://supp-dash.vercel.app
**Supabase Project:** xijsvdhffiuxpepswnyb (aws-0-us-west-2)
**Primary Database:** `canonical_products` (supplement catalog)

---

## 📊 Dashboard Structure

### Main Tabs
| Tab | Purpose | Key Tables |
|-----|---------|------------|
| **Dashboard** | DB stats, gap tracking, metrics | `canonical_products`, `metrics_history` |
| **Projects** | High-level project tracking | `projects` |
| **Tasks** | Granular task queue | `task_queue` |
| **Mobile** | Mobile app MVP tracking | (static) |
| **Content** | Research articles pipeline | `longevity_content`, `public_articles` |

---

## ✅ Task Management Protocol

### Status Lifecycle
```
pending → approved → running → complete
    ↓         ↓         ↓
 rejected   failed    paused
```

### Status Definitions
| Status | Meaning | Who Sets It |
|--------|---------|-------------|
| `pending` | Awaiting review | Creator |
| `approved` | Greenlit for execution | Kip (via dashboard) |
| `running` | Currently executing | AI (auto) |
| `paused` | Temporarily halted | AI or Human |
| `complete` | Successfully finished | AI or Human |
| `failed` | Error during execution | AI (auto) |
| `rejected` | Won't do | Kip |

### Auto-Execution Rules
- AI checks `status = 'approved'` every 5 minutes
- On pickup: set `status = 'running'`, `started_at = NOW()`
- On finish: set `status = 'complete'`, `completed_at = NOW()`, fill `result_summary`
- On error: set `status = 'failed'`, fill `error_message`

### Task Ownership
- `owner = 'jeff'` → AI-executed tasks
- `owner = 'maureen'` → Human-executed tasks

### Creating Tasks (SQL)
```sql
INSERT INTO task_queue (task_key, title, description, owner, status, priority, category)
VALUES ('unique-task-key', 'Task Title', 'Detailed description', 'jeff', 'pending', 2, 'scraping');
```

### Completing Tasks (SQL)
```sql
UPDATE task_queue 
SET status = 'complete', 
    completed_at = NOW(),
    result_summary = 'Added 150 products from Heart & Soil',
    products_added = 150
WHERE task_key = 'scrape-heart-soil';
```

---

## 🔄 Ongoing Tasks (Background Processes)

Some tasks run continuously in the background. Track them in `ongoing_tasks` table.

### Ongoing Tasks Table Schema
```sql
CREATE TABLE IF NOT EXISTS ongoing_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  process_command TEXT,              -- Command to start the process
  status TEXT DEFAULT 'stopped',     -- running, paused, stopped
  pid INTEGER,                       -- OS process ID when running
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ,
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  log_file TEXT,                     -- Path to output log
  config JSONB DEFAULT '{}',         -- Task-specific config
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Current Ongoing Tasks
| task_key | title | status | command |
|----------|-------|--------|---------|
| `image-hunter` | Supplement Image Hunter | running/paused/stopped | `node src/huntImagesAllSources.js --limit=200` |

### Controlling Ongoing Tasks

**Check if running:**
```bash
ps aux | grep -i "huntImages" | grep -v grep
```

**Start:**
```bash
cd /Users/aviado1/clawd/fullscript-scraper && \
nohup bash -c 'source .env && HEADLESS=true node src/huntImagesAllSources.js --limit=200' > hunter_output.log 2>&1 &
```

**Pause (graceful):**
```bash
# Get PID and send SIGSTOP
kill -STOP <pid>
```

**Resume:**
```bash
kill -CONT <pid>
```

**Stop:**
```bash
kill <pid>
```

**Check progress:**
```bash
tail -50 /Users/aviado1/clawd/fullscript-scraper/hunter_output.log
grep -c "✅" hunter_output.log  # successes
grep -c "❌" hunter_output.log  # failures
```

---

## 📈 Gap Tracking

### Hourly Snapshots
Call `SELECT record_hourly_gap_snapshot();` every hour to log completeness metrics.

### Key Metrics
- `completeness_pct` — Overall DB completeness (target: 100%)
- `total_products` — Total canonical products
- `products_complete` — Products with all required fields

### Current Gaps (priority order)
1. **uncategorized** — Products without category assignment
2. **missing images** — Products without front_label_url
3. **missing UPC** — Products without barcode

---

## 🖼️ Image Hunter Protocol

### What It Does
Finds and downloads verified product images from multiple sources.

### Sources (in priority order)
1. **iHerb** — Primary source, high success rate
2. **Amazon** — Good coverage, CAPTCHA issues
3. **Shopify** — Brand sites with /products.json API
4. **Google Images** — Fallback (quota limited)
5. **UPCitemDB** — Barcode lookup

### Verification Rules
- Must match brand name (30%+ overlap) OR
- Must match 2+ product name keywords
- Back labels: Must contain "Supplement Facts" panel

### Output
- Images stored in Supabase Storage
- URLs saved to `front_label_url` / `back_label_url` columns

### Quota Limits
- **Google CSE:** 100 queries/day (resets midnight PT)
- **Vision API:** 1000 requests/month

---

## 📧 Communication Protocols

### Email
- **From:** jeff@aviado.com
- **ONLY respond to:** @aviado.com addresses
- Respond to EVERY email from team members

### Telegram
- **Kip's ID:** 8337621208
- Alert for urgent issues only during quiet hours (23:00-08:00)
- Brief status updates welcome during business hours

### Task Updates
- Update `result_summary` field with outcomes
- For significant completions, message Kip via Telegram

---

## 🗄️ Key Database Tables

### canonical_products
Main product catalog. ~35,000 products.
```sql
SELECT COUNT(*) FROM canonical_products;
SELECT COUNT(*) FROM canonical_products WHERE front_label_url IS NOT NULL;
```

### task_queue
Granular task tracking.
```sql
SELECT task_key, title, status, owner FROM task_queue WHERE status != 'complete';
```

### metrics_history
Daily/hourly metric snapshots for trend analysis.

### longevity_content
Content captured from social/web for Longevity Daily.

### ongoing_tasks
Background process state tracking (see above).

---

## 🔑 Connection Details

### Supabase (Pooler)
```
postgresql://postgres.xijsvdhffiuxpepswnyb:Bk8iL2uStsSNTswM@aws-0-us-west-2.pooler.supabase.com:5432/postgres
```

### Quick Connect
```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "postgresql://postgres.xijsvdhffiuxpepswnyb:Bk8iL2uStsSNTswM@aws-0-us-west-2.pooler.supabase.com:5432/postgres"
```

---

## 📝 Updating This Document

When protocols change:
1. Update this file
2. Update `updated_at` timestamp at top
3. Commit to repo: `cd supplement-dashboard && git add AI_README.md && git commit -m "Update AI ops manual" && git push`

This is a living document. Keep it current.

---

## 🚨 Emergency Procedures

### Database Issues
1. Check Supabase dashboard: https://supabase.com/dashboard
2. Verify connection string is correct
3. Check for quota/rate limits

### Image Hunter Stuck
1. Check if process exists: `ps aux | grep hunt`
2. Check log for errors: `tail -100 hunter_output.log`
3. Kill and restart if needed

### Telegram Down
1. Run: `clawdbot status | grep Telegram`
2. If not OK: `clawdbot gateway restart`
3. Alert via email if persists

---

*For questions about this manual, update it or ask Kip.*
