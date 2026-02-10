# AI Operations Manual — Supplement Dashboard

*Last updated: 2026-02-10 07:00 CST by Maureen*
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
| **Tasks** | Granular task queue + ongoing processes | `task_queue`, `ongoing_tasks` |
| **Mobile** | Mobile app MVP tracking | (static) |
| **Content** | Research articles pipeline | `longevity_content`, `public_articles` |
| **Diagrams** | ASCIIFlow editor — architecture, flows, specs | localStorage (Supabase planned) |

### Tasks Tab — Sub-Tabs
The Tasks tab has four filter views:

| Sub-Tab | Shows | Use For |
|---------|-------|---------|
| **📋 Open Tasks** | pending, approved, running, planning, research | Active work items |
| **✅ Completed** | complete, completed | Finished tasks |
| **🔄 Ongoing** | Background processes (Image Hunter, etc.) | Pause/resume long-running jobs |
| **📑 All** | Everything | Full view |

---

## 📁 Projects Tab — High-Level Work Tracking

### What is a "Project"?
A **project** is a significant body of work that spans multiple tasks and days/weeks. Projects are tracked at a higher level than individual tasks.

**Examples:**
- Mobile App development
- AviScore v2 research
- Brand Gaps scraping initiative
- Drug-Supplement Interactions database

**NOT projects (these are tasks):**
- "Scrape Heart & Soil products"
- "Fix image verification bug"
- "Add Mark Complete button"

### Project Tracking: Two Systems

**1. Supabase `projects` table** — Dashboard display
| Column | Purpose |
|--------|---------|
| `slug` | Unique identifier (e.g., "mobile-app") |
| `name` | Display name |
| `status` | planning, research, active, paused, complete |
| `priority` | critical, high, medium, low |
| `local_path` | Path to local project folder |
| `owner` | jeff, maureen, kip |
| `target_date` | When we aim to complete |

**2. Local `projects/` directory** — Detailed working notes
```
/Users/aviado1/clawd/projects/
├── _archive/              # Completed projects
├── mobile-app/
│   └── STATUS.md          # Current state, goals, blockers
├── aviscore-v2/
│   └── STATUS.md
├── brand-gaps/
│   └── STATUS.md
├── supplement-database/
│   ├── STATUS.md
│   └── research/          # Sub-agent findings, analysis
├── longevity-daily/
│   ├── STATUS.md
│   └── NEWSLETTER_EVOLUTION_RESEARCH.md
└── [other-projects]/
```

### STATUS.md — The Sacred File

Every project folder MUST have a `STATUS.md` with:

```markdown
# [Project Name] - Status

**Last Updated:** YYYY-MM-DD HH:MM CST

## Current State
🔄 Active | ⏸️ Paused | ✅ Complete | 📋 Planning

## Recent Progress
- What just happened

## Next Steps
- What's pending

## Blockers
- What's in the way

## Key Files
- Important paths/scripts
```

**Update STATUS.md after every meaningful work session.** This saves you when context gets compacted.

### Project Lifecycle
```
planning → research → active → complete → _archive/
              ↓
           paused
```

### Creating a New Project

1. **Add to Supabase:**
```sql
INSERT INTO projects (slug, name, status, priority, local_path, owner)
VALUES ('my-project', 'My New Project', 'planning', 'medium', 'projects/my-project', 'jeff');
```

2. **Create local folder:**
```bash
mkdir -p /Users/aviado1/clawd/projects/my-project
```

3. **Create STATUS.md:**
```bash
echo "# My Project - Status\n\n**Last Updated:** $(date)\n\n## Current State\n📋 Planning" > projects/my-project/STATUS.md
```

### Archiving Completed Projects
```bash
mv projects/my-project projects/_archive/
```
Update Supabase status to `complete`.

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
- **Jeff** checks `status = 'approved'` every 5 minutes
- **Maureen** checks every hour (cron job)
- **Approved = GO.** Start immediately, own through completion. Sequential by priority.
- On pickup: set `status = 'running'`, `started_at = NOW()`
- On finish: set `status = 'complete'`, `completed_at = NOW()`, fill `result_summary`
- On error: set `status = 'failed'`, fill `error_message`

### Task Ownership
- `owner = 'jeff'` → CTO tasks (infrastructure, scraping, database)
- `owner = 'maureen'` → CMO tasks (content, social, marketing, Outpost)
- `owner = 'kip'` → Tasks requiring Kip's direct action

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

## ✏️ Diagrams Tab (ASCIIFlow)

**Added:** 2026-02-10 by Maureen

Self-hosted ASCIIFlow for architecture diagrams, flow design, and spec collaboration.

### Files
- `asciiflow/` — Built bundle + assets (served statically via iframe)
- `asciiflow-src/` — Full TypeScript source for modifications
- Build: `cd asciiflow-src && npm install && npx webpack --config webpack.prod.config.cjs`
- Copy output: `cp dist/* ../asciiflow/`

### Features
- Fullscreen mode button
- **Supabase persistence** via `supabase-bridge.js` — save/load/delete diagrams
- ☁️ Diagrams button in top-right opens save/load panel
- Auto-saves every 30 seconds when a diagram is loaded
- Diagrams stored in `diagrams` table (id, title, content, project_key, created_by)
- **Version history**: `diagram_versions` table, viewable via 📜 History button, restore any version
- **Markdown export**: 📋 Copy as Markdown — wraps diagram in code block for specs
- Each save creates a version snapshot for rollback
- **How-To page**: `asciiflow/how-to.html` — drawing tools, shortcuts, conventions, developer guide
- 📖 How-To button on the Diagrams tab header links to the guide, AI how-to page

### Rebuilding After Source Changes
```bash
cd asciiflow-src
npm install           # first time only
npx webpack --config webpack.prod.config.cjs
cp dist/asciiflow.bundle.js ../asciiflow/
cp dist/index.html ../asciiflow/
```

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

## 📝 Change Management — EVERYONE READ THIS

**This file is the single source of truth.** When anyone (human or AI) changes the dashboard, this file MUST be updated.

### When to Update This File

| Change Type | Action Required |
|-------------|-----------------|
| New tab added | Add to "Dashboard Structure" section |
| New table created | Add to "Key Database Tables" section |
| Task workflow changed | Update "Task Management Protocol" section |
| New ongoing task type | Add to "Ongoing Tasks" section |
| New API/connection | Add to "Connection Details" section |
| UI button/feature added | Document in relevant section |
| Protocol changed | Update the relevant protocol section |

### How to Update

1. **Edit this file** with your changes
2. **Update the timestamp** at the top: `*Last updated: YYYY-MM-DD HH:MM CST by [Name]*`
3. **Commit with your code changes:**
   ```bash
   cd supplement-dashboard
   git add -A
   git commit -m "Your feature + update AI_README"
   git push
   ```
4. **Deploy if needed:** `npx vercel --prod`

### Why This Matters

- **Jeff (AI)** reads this file to understand how to operate the dashboard
- **Future AI agents** will rely on this for onboarding
- **Humans** can reference this instead of asking questions
- **No more email chains** explaining how things work

### What Happens If You Don't Update

- AI agents will have outdated understanding
- Features won't be used correctly
- Protocols drift apart
- Someone has to email instructions (defeats the purpose)

**Rule: If you touch the dashboard, touch this file.**

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
