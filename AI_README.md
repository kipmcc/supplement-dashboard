# AI Operations Manual — Supplement Dashboard

*Last updated: 2026-02-16 08:00 CST by Maureen — cross-agent task linking & auto-resolution (linked_task_key)*
*This file is the single source of truth for AI agents operating on this system.*

---

## 📖 Per-Tab Guides

Each dashboard tab has a detailed guide for AI agents. These are living documents — **update the relevant guide whenever you change a tab's functionality.**

| Tab | Guide File | Covers |
|-----|-----------|--------|
| **Dashboard** | [`docs/DASHBOARD_GUIDE.md`](docs/DASHBOARD_GUIDE.md) | Metrics, charts, fleet status, gap trends |
| **Projects** | [`docs/PROJECTS_GUIDE.md`](docs/PROJECTS_GUIDE.md) | Project lifecycle, STATUS.md, subtasks |
| **Tasks** | [`docs/TASKS_GUIDE.md`](docs/TASKS_GUIDE.md) | Task queue, approval workflow, ongoing tasks |
| **Pipeline** | [`docs/PIPELINE_GUIDE.md`](docs/PIPELINE_GUIDE.md) | Pipeline health, content queue, throughput |
| **Diagrams** | [`asciiflow/AVIFLOW_GUIDE.md`](asciiflow/AVIFLOW_GUIDE.md) | AviFlow editor, Supabase API, drawing guide |

**Rule: If you change a tab, update its guide.**

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
| **Projects** | High-level project tracking | `task_queue` (where `is_project=true`) |
| **Tasks** | Granular task queue + ongoing processes | `task_queue`, `ongoing_tasks` |
| **Pipeline** | Product pipeline & processing status | `canonical_products`, `product_sources` |
| **Diagrams** | AviFlow editor (navigates to `/asciiflow/`) | `diagrams`, `diagram_versions` |

### Tasks Tab — Sub-Tabs
The Tasks tab has four filter views plus an **agent selector**:

| Sub-Tab | Shows | Use For |
|---------|-------|---------|
| **📋 Open Tasks** | pending, approved, running, blocked, planning, research | Active work items |
| **✅ Completed** | complete, completed | Finished tasks |
| **🔄 Ongoing** | Background processes (Image Hunter, etc.) | Pause/resume long-running jobs |
| **📑 All** | Everything | Full view |

**Agent Selector Pills:** Filter tasks by agent (All, Jeff, Maureen, Kip, etc.). Agents loaded dynamically from `agents` table.

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

**1. Supabase `task_queue` table (where `is_project=true`)** — Dashboard display
Projects are stored as rows in `task_queue` with `is_project=true`, not in a separate table.
| Column | Purpose |
|--------|---------|
| `project_key` | Unique identifier (e.g., "mobile-app") |
| `title` | Display name |
| `status` | planning, research, active, paused, complete |
| `priority` | 1 (critical), 2 (high), 3 (medium), 4 (low) |
| `owner` | jeff, maureen, kip |

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
INSERT INTO task_queue (task_key, title, status, priority, owner, is_project, project_key)
VALUES ('my-project', 'My New Project', 'planning', 3, 'jeff', true, 'my-project');
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
Update task_queue status to `complete` (where `is_project=true` and matching `project_key`).

---

## ✅ Task Management Protocol

### Status Lifecycle
```
pending → approved → running → complete
    ↓         ↓         ↓
 rejected   failed    blocked → running (when unblocked)
```

### Status Definitions
| Status | Meaning | Who Sets It |
|--------|---------|-------------|
| `pending` | Awaiting review | Creator |
| `approved` | Greenlit for execution | Kip (via dashboard) |
| `running` | Currently executing | AI (auto) |
| `blocked` | Waiting on human answer | Agent (via blocking message) or Human |
| `complete` | Successfully finished | AI or Human |
| `failed` | Error during execution | AI (auto) |
| `rejected` | Won't do | Kip |

### Blocking Questions
Agents can post blocking questions on any task via `task_messages`:
1. Agent INSERTs a message with `is_blocking = true`
2. Task status changes to `blocked`
3. Human reads the question on the dashboard, types an answer, clicks **Resolve**
4. `resolveMessage()` marks the message resolved and checks for remaining blockers
5. If no more unresolved blocking messages, task auto-returns to `running`

### Agent Registry
Agents are stored in the `agents` table (not hardcoded). Register new agents:
```sql
INSERT INTO agents (name, display_name, role, emoji, color)
VALUES ('new-agent', 'New Agent', 'Specialist', '🔬', 'emerald')
ON CONFLICT (name) DO NOTHING;
```

### Auto-Execution Rules
- Agents check `status = 'approved'` on their schedule
- **Approved = GO.** Start immediately, own through completion. Sequential by priority.
- On pickup: set `status = 'running'`, `started_at = NOW()`
- On finish: set `status = 'complete'`, `completed_at = NOW()`, fill `result_summary`
- On error: set `status = 'failed'`, fill `error_message`
- On blocker: INSERT into `task_messages` with `is_blocking = true`, set task `status = 'blocked'`

### Task Ownership
Ownership is dynamic — any agent in the `agents` table can own tasks. Current agents:
- `jeff` → AI CTO (infrastructure, scraping, database)
- `maureen` → AI CMO (content, social, marketing)
- `kip` → Human (tasks requiring human action)

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

Self-hosted ASCIIFlow (branded "AviFlow") for architecture diagrams, flow design, and spec collaboration. Supabase-backed persistence with colored text support (v0.9.2).

### Files
- `asciiflow/` — Built bundle + static overrides (served via iframe from main dashboard, direct nav from tab)
- `asciiflow-src/` — Full TypeScript source for modifications
- Build: `cd asciiflow-src && npx webpack --config webpack.prod.config.cjs`
- Copy output: `cp dist/asciiflow.bundle.js ../asciiflow/` (do NOT copy dist/index.html — asciiflow/index.html has custom CSS overrides)

### Features
- Fullscreen mode button
- **Supabase persistence** via `supabase-bridge.js` — save/load/rename/duplicate/delete diagrams
- Sidebar panel replaces native ASCIIFlow File menu with compact file manager
- Auto-saves every 30 seconds when a diagram is loaded
- `diagrams` table: id (uuid), title, content (text), project_key, created_by, tags (jsonb), version_count (int), created_at, updated_at
- `diagram_versions` table: id, diagram_id (FK), content, saved_by, created_at — each save creates a version snapshot
- **Sidebar layout**: filter input → scrollable file list → detail bar (project/author/date) → unified toolbar (Save, New, Rename, Duplicate, Delete, Copy)
- **Markdown export**: 📋 Copy as Markdown — wraps diagram in code block for specs
- **AviFlow Guide**: `asciiflow/AVIFLOW_GUIDE.md` — drawing tools, shortcuts, conventions, developer guide

### Direct Supabase API (creating diagrams without the UI)
```bash
curl -X POST "$SUPABASE_URL/rest/v1/diagrams" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"title":"My Diagram","content":"┌──┐\n│Hi│\n└──┘","project_key":"myproject","created_by":"claude","tags":[],"version_count":1}'
```

### Rebuilding After Source Changes
```bash
cd asciiflow-src
npm install           # first time only
npx webpack --config webpack.prod.config.cjs
cp dist/asciiflow.bundle.js ../asciiflow/asciiflow.bundle.js
# Do NOT copy dist/index.html — asciiflow/index.html has custom CSS/HTML overrides
```

### Creating Diagrams Programmatically (AI Agents)

See **`asciiflow/AVIFLOW_GUIDE.md`** for the full guide. Key points:

**Browser API:**
```javascript
// Core
window.__aviflow_api.loadText(diagramString);  // Load text into canvas
window.__aviflow_api.getText();                 // Read canvas content
_af.load('diagram-uuid');                       // Load from Supabase
_af.topLeft();                                  // Position viewport
_af.refresh();                                  // Refresh sidebar list

// Color — agents can mark changes visually
window.__aviflow_api.setColor('red');           // Set active drawing color (red|blue|green|orange|purple|null)
window.__aviflow_api.getColor();                // Get current active color (hex or null)
window.__aviflow_api.getTextWithColors();        // → { text: "...", colors: { "5:10": "red", ... } }
window.__aviflow_api.applyColors({ "5:10": "red", "6:10": "blue" });  // Bulk-set colors by position key
window.__aviflow_api.recolorRegion(x1, y1, x2, y2, 'blue');           // Recolor a bounding box

// Row operations (undoable)
window.__aviflow_api.insertRow(y);              // Insert blank row at Y, shift content down
window.__aviflow_api.deleteRow(y);              // Delete row at Y, shift content up
```

**Color persistence:** When colors are present, diagram content is stored as `{"text":"...","colors":{"x:y":"#hex",...}}`. Old plain-text diagrams load normally (no colors). Position keys use `x:y` format matching Vector.toString().

**Direct Supabase API (preferred for automation — no prompts):**
```bash
curl -X POST "$SUPABASE_URL/rest/v1/diagrams" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "title": "My Diagram",
    "content": "┌──────┐\n│ Box  │\n└──────┘",
    "project_key": "outpost",
    "created_by": "maureen",
    "tags": ["architecture"],
    "version_count": 1
  }'
```

**Critical rules for well-formed diagrams:**
1. **Every line must be exactly the same width** — pad with spaces
2. Use Unicode box chars: `┌─┐│└┘├┤┬┴┼`
3. Use Unicode arrows: `▲▼◄►` (not ASCII `v^<>`)
4. Validate line widths programmatically before saving
5. Use the `r()` builder pattern from the guide for consistent padding

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
Granular task tracking. Supports cross-agent linking via `linked_task_key`.
```sql
SELECT task_key, title, status, owner, linked_task_key FROM task_queue WHERE status != 'complete';
```
**Cross-agent cascade:** When a task with `linked_task_key` is marked complete, the dashboard auto-unblocks the linked task, resolves its blocking messages, and posts a resolution message. See `docs/TASKS_GUIDE.md` for details.

### agents
Dynamic agent registry. Drives agent selector pills and owner sections.
```sql
SELECT name, display_name, role, emoji, color FROM agents WHERE status = 'active';
```

### task_messages
Per-task threaded conversations with blocking question support.
```sql
SELECT * FROM task_messages WHERE task_key = 'some-task' ORDER BY created_at;
-- Check unresolved blockers:
SELECT * FROM task_messages WHERE task_key = 'some-task' AND is_blocking = true AND is_resolved = false;
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

## 📐 AviFlow — Creating Diagrams Programmatically

The **Diagrams tab** on supp-dash.vercel.app uses the AviFlow tool. Full guide: `asciiflow/AVIFLOW_GUIDE.md` in this repo.

### Direct Supabase API (recommended for automation)

```bash
SUPABASE_URL='https://xijsvdhffiuxpepswnyb.supabase.co'
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzU0NTYsImV4cCI6MjA4MTc1MTQ1Nn0.Y5igqaP-p4ZvvVP47xvy4SFCyZE030wyuITYIUwWlRI'

curl -X POST "${SUPABASE_URL}/rest/v1/diagrams" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "title": "My Diagram Title",
    "content": "┌──────┐\n│ Box  │\n└──────┘",
    "project_key": "outpost",
    "created_by": "jeff",
    "tags": ["architecture"],
    "version_count": 1
  }'
```

**Required:** `title`, `content` (newline-separated rows)
**Optional:** `project_key` (groups in sidebar), `created_by` (`jeff`/`maureen`/`claude`), `tags` (string array)

### Builder Pattern (Critical: every line must be exactly the same width)

```python
W = 52  # inner width between │ borders

def r(content=''):
    return '│' + content.ljust(W)[:W] + '│'

lines = [
    '┌' + '─' * W + '┐',          # top
    r('  Title Here'),              # content
    '├' + '─' * W + '┤',          # divider
    r('  - Item one'),
    '└' + '─' * W + '┘',          # bottom
]

# VALIDATE before saving
for i, line in enumerate(lines):
    assert len(line) == W + 2, f"Line {i} is {len(line)} chars, expected {W+2}"

content = '\n'.join(lines)
```

### Character Reference

- **Box-drawing:** `┌─┐│└┘├┤┬┴┼` (always Unicode, never ASCII `+|-`)
- **Arrows:** `▲▼◄►` (always Unicode, never ASCII `v^<>`)
- **Connections:** `───►` horizontal, `│` + `▼` vertical
- **Tees:** `┬` (split down), `┴` (merge up), `├` (split right), `┤` (merge left)

### Updating an Existing Diagram

1. Save version snapshot: POST to `diagram_versions` with `diagram_id`, `content`, `saved_by`
2. Update diagram: PATCH `diagrams?id=eq.UUID` with new `content`, `updated_at`, incremented `version_count`

### Browser API (inside AviFlow page)

```javascript
window.__aviflow_api.loadText(diagramString);  // Load into canvas
window.__aviflow_api.getText();                 // Read from canvas
_af.load('diagram-uuid');                       // Load from Supabase
_af.refresh();                                  // Refresh sidebar
_af.topLeft();                                  // Reposition viewport
```

### Schema

- **`diagrams`:** id (uuid), title, content (text), project_key, created_by, tags (jsonb), version_count (int), created_at, updated_at
- **`diagram_versions`:** id, diagram_id (FK), content, saved_by, created_at

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
