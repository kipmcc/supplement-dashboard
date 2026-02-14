# Projects Tab Guide — For AI Agents

*How to create, manage, and track projects on the dashboard.*

*Last updated: 2026-02-14*

---

## Purpose

The Projects tab tracks **high-level bodies of work** that span multiple tasks and days/weeks. Projects are distinct from tasks — a project is a strategic initiative, while tasks are the individual work items within it.

**Examples of projects:** Mobile App, AviScore v2, Brand Gaps Initiative, Drug-Supplement Interactions DB
**NOT projects (these are tasks):** "Scrape Heart & Soil", "Fix image bug", "Add button"

---

## How Projects Work

Projects are stored in the **same `task_queue` table** as tasks, distinguished by `is_project = true`. This means:
- Projects and tasks share the same schema
- Projects can have subtasks linked via `project_key`
- All CRUD operations use the `task_queue` table

---

## UI Layout

### Summary Cards
| Card | What it shows |
|------|---------------|
| Total Projects | Count of `task_queue` where `is_project = true` |
| Critical | Projects with `priority = 1` |
| High | Projects with `priority = 2` |
| Active | Projects not in `complete`, `completed`, or `archived` status |

### Project Grid
Projects are grouped by **owner** (`jeff`, `maureen`), then displayed as cards showing:
- Title, priority badge, status indicator
- Description
- Subtask count and completion progress
- Local file path reference (`projects/{project_key}/`)

---

## Database Schema

### `task_queue` (project rows)
```sql
-- Key columns for projects
SELECT task_key, title, description, status, priority, owner,
       is_project, project_key, created_at, updated_at
FROM task_queue
WHERE is_project = true
ORDER BY priority ASC;
```

| Column | Type | Notes |
|--------|------|-------|
| `task_key` | text | Unique identifier (e.g., `mobile-app`) |
| `title` | text | Display name |
| `description` | text | Project description |
| `status` | text | `planning`, `research`, `active`, `paused`, `complete` |
| `priority` | int | 1 (critical) through 6 (backlog) |
| `owner` | text | `jeff`, `maureen`, `kip` |
| `is_project` | bool | Must be `true` for projects |
| `project_key` | text | Matches folder name in `projects/` |

### Subtask linking
Tasks are linked to projects via `project_key`:
```sql
-- Get all subtasks for a project
SELECT * FROM task_queue
WHERE is_project = false AND project_key = 'mobile-app'
ORDER BY priority ASC;
```

---

## Project Lifecycle

```
planning --> research --> active --> complete --> archived
               |
            paused
```

### Status Definitions
| Status | Meaning |
|--------|---------|
| `planning` | Scoping, requirements gathering |
| `research` | Investigation phase |
| `active` | Work in progress |
| `paused` | Temporarily halted |
| `complete` | All work finished |
| `archived` | Moved to `_archive/` |

### Priority Levels
| Priority | Badge | Meaning |
|----------|-------|---------|
| 1 | Red | Critical — blocking other work |
| 2 | Orange | High — important initiative |
| 3 | Yellow | Medium — normal priority |
| 4 | Blue | Low — when time allows |
| 5-6 | Gray | Backlog |

---

## Creating a Project

### Via Supabase (recommended for agents)
```sql
INSERT INTO task_queue (task_key, title, description, status, priority, owner, is_project, project_key)
VALUES (
  'my-project-key',
  'My New Project',
  'Detailed description of what this project achieves',
  'planning',
  3,
  'jeff',
  true,
  'my-project-key'
);
```

### Local project folder
Each project should have a corresponding local folder with a `STATUS.md`:
```
projects/my-project-key/
  STATUS.md    # Current state, progress, blockers
  research/    # Optional — findings, analysis
```

### STATUS.md template
```markdown
# [Project Name] - Status

**Last Updated:** YYYY-MM-DD HH:MM CST

## Current State
Planning | Active | Paused | Complete

## Recent Progress
- What just happened

## Next Steps
- What's pending

## Blockers
- What's in the way

## Key Files
- Important paths/scripts
```

---

## Adding Subtasks to a Project

```sql
INSERT INTO task_queue (task_key, title, description, owner, status, priority, category, project_key, is_project)
VALUES (
  'scrape-heart-soil',
  'Scrape Heart & Soil products',
  'Use Shopify scraper to pull all products',
  'jeff',
  'pending',
  2,
  'scraping',
  'brand-gaps',    -- links to the brand-gaps project
  false            -- this is a task, not a project
);
```

---

## Completing / Archiving a Project

```sql
-- Mark complete
UPDATE task_queue
SET status = 'complete', completed_at = NOW(), updated_at = NOW()
WHERE project_key = 'my-project' AND is_project = true;

-- Move local folder to archive
-- mv projects/my-project projects/_archive/
```

---

## What Agents Can Do

### Read
- List all projects: `SELECT * FROM task_queue WHERE is_project = true ORDER BY priority`
- Get subtasks: `SELECT * FROM task_queue WHERE project_key = '...' AND is_project = false`
- Check progress: count completed vs total subtasks per project

### Write
- Create new projects (INSERT with `is_project = true`)
- Add subtasks (INSERT with matching `project_key`)
- Update project status (UPDATE `status`, `updated_at`)
- Update STATUS.md files in local project folders

### Owner assignments
| Owner | Role | Typical work |
|-------|------|-------------|
| `jeff` | AI CTO | Infrastructure, scraping, database |
| `maureen` | AI CMO | Content, social, marketing |
| `kip` | Human | Requires Kip's direct action |

---

## Browser API

```javascript
// Reload projects tab
window.loadProjects();
```
