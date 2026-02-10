# AI Operations Manual — Aviado Dashboard

**Last Updated:** 2026-02-10 06:30 CST — Maureen Vale
**Source of Truth:** This file. Read it before making dashboard changes.

---

## Dashboard Structure

**URL:** https://supp-dash.vercel.app
**Repo:** github.com/kipmcc/supplement-dashboard
**Deploy:** Vercel (auto-deploys on push to main)
**Stack:** Vanilla JS + Tailwind CDN + Supabase client (no build step for dashboard itself)

### Tab Structure

| Tab | Button | Purpose |
|-----|--------|---------|
| 📊 Dashboard | `tab-dashboard` | Database overview — product counts, coverage, brand quality |
| 📁 Projects | `tab-projects` | Project tracking (Planning → Research → Building → Testing → Done) |
| ✅ Tasks | `tab-tasks` | Task approval queue — Kip approves, Jeff/Maureen execute |
| 🔄 Pipeline | `tab-pipeline` | Content pipeline status — article generation, quality scores |
| ✏️ Diagrams | `tab-asciiflow` | ASCIIFlow diagram editor — architecture, flows, specs |

### Task Tab Sub-Views

| Sub-Tab | Shows |
|---------|-------|
| 📋 Open Tasks | Pending + approved + running tasks |
| ✅ Completed | Finished tasks with result summaries |
| 🔄 Ongoing | Background processes (Image Hunter) with pause/resume/stop |
| 📑 All | Everything regardless of status |

---

## Task Management Protocol

### Status Lifecycle

```
pending → approved → running → complete
                  ↘ rejected
           running → failed
```

### Owners

- **jeff** — CTO tasks (infrastructure, scraping, database)
- **maureen** — CMO tasks (content, social, marketing, Outpost)
- **kip** — Tasks requiring Kip's direct action (e.g., GA4 property creation)

### How It Works

1. Anyone creates tasks (status: `pending`)
2. **Kip approves** tasks in the dashboard
3. Agents check for approved tasks:
   - Jeff: every 5 minutes
   - Maureen: every hour (cron job)
4. **Approved = GO.** Start immediately, own through completion
5. If multiple approved: handle sequentially by priority (lower number = higher priority)
6. Mark complete with result summary when done

### SQL Quick Reference

```sql
-- Connection
psql -h aws-0-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.xijsvdhffiuxpepswnyb -d postgres

-- Check approved tasks
SELECT id, title, status, priority, owner
FROM task_queue WHERE status = 'approved' ORDER BY priority;

-- Start a task
UPDATE task_queue SET status = 'running', started_at = now()
WHERE id = '<task-id>';

-- Complete a task
UPDATE task_queue SET status = 'complete', completed_at = now(),
  result_summary = 'What was done' WHERE id = '<task-id>';

-- Create a task
INSERT INTO task_queue (task_key, title, description, status, priority, owner, project_key, is_project, category)
VALUES ('my-task-key', 'Task Title', 'Description', 'pending', 5, 'maureen', 'project-key', false, 'category');
```

### ✓ Mark Complete Button

Available on any non-pending, non-complete task. Prompts for optional result summary. Updates `status = 'complete'` and `completed_at = now()`.

---

## Ongoing Tasks Tab

For long-running background processes (e.g., Image Hunter):

- Shows tasks with `status = 'running'` that are background/continuous
- **Pause/Resume/Stop** controls available
- Use for processes that run indefinitely, not one-shot tasks

---

## ✏️ Diagrams Tab (ASCIIFlow)

**Added:** 2026-02-10 by Maureen

Self-hosted ASCIIFlow for architecture diagrams, flow design, and spec collaboration.

### Files

- `asciiflow/` — Built bundle + assets (served statically)
- `asciiflow-src/` — Full source code for modifications
- Build: `cd asciiflow-src && npm install && npx webpack --config webpack.prod.config.cjs`
- Copy output: `cp dist/* ../asciiflow/`

### How It Works

- Embedded via iframe in the Diagrams tab
- Fullscreen button for full-screen editing
- Currently uses localStorage for persistence (browser-local)
- **Planned:** Supabase persistence, project-linked diagrams, version history

### Rebuilding After Source Changes

```bash
cd asciiflow-src
npm install           # first time only
npx webpack --config webpack.prod.config.cjs
cp dist/asciiflow.bundle.js ../asciiflow/
cp dist/index.html ../asciiflow/
```

---

## Database Connection

- **Supabase Project:** `xijsvdhffiuxpepswnyb`
- **Host:** `aws-0-us-west-2.pooler.supabase.com`
- **Port:** 5432
- **User:** `postgres.xijsvdhffiuxpepswnyb`
- **Database:** `postgres`
- **Table:** `task_queue`

---

## Emergency Procedures

### Dashboard Not Loading
1. Check Vercel deployment status
2. Check Supabase project status at supabase.com/dashboard
3. Verify no breaking changes in recent commits

### Task Stuck in "Running"
```sql
-- Check what's running
SELECT id, title, started_at FROM task_queue WHERE status = 'running';

-- Force complete if stuck
UPDATE task_queue SET status = 'failed', error_message = 'Stuck — manually failed'
WHERE id = '<task-id>';
```

### Supabase Connection Issues
- Check if credentials are valid
- Verify IP isn't blocked
- Try direct psql connection before assuming dashboard issue

---

## ⚠️ When You Change the Dashboard

1. **Update this file** (AI_README.md) with your changes
2. **Update the timestamp** at the top of this file
3. **Commit with the rest of your changes**

This keeps all agents in sync automatically.
