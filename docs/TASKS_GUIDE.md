# Tasks Tab Guide — For AI Agents

*How to create, approve, execute, and manage tasks on the dashboard.*

*Last updated: 2026-02-14*

---

## Purpose

The Tasks tab is the **operational work queue**. It shows granular, actionable tasks that agents pick up and execute. Agents are registered dynamically in the `agents` table (no hardcoded list), and each task supports a threaded message conversation with blocking-question support. Tasks flow through a defined lifecycle from creation to completion, with a new `blocked` status for tasks waiting on human input.

---

## UI Layout

### Summary Cards (top row)
| Card | Source |
|------|--------|
| Total Tasks | Count of all `task_queue` rows (where `is_project = false`) |
| Pending | Status = `pending` |
| Blocked | Status = `blocked` |
| Approved/Running | Status = `approved` or `running` |
| Completed | Status = `complete` or `completed` |
| Est. Products | Sum of `estimated_products` for non-complete tasks |

### Agent Selector Pills
A horizontal row of filter pills below the summary cards. Each pill shows an agent's emoji, display name, and current task count. Clicking a pill filters the task list to that agent. The pills are populated dynamically from the `agents` table (only agents with `status = 'active'`). An "All" pill is always present to remove the filter.

### Approval Workflow Banner
Blue info box explaining the approve/reject/complete workflow.

### Sub-Tab Filters
| Sub-Tab | Filter Logic |
|---------|-------------|
| Open Tasks | Status NOT in (`complete`, `completed`, `rejected`) — includes `blocked` tasks since they are active |
| Completed | Status in (`complete`, `completed`) |
| Ongoing | Shows `ongoing_tasks` table (background processes) |
| All | No filter — everything |

### Task Cards
Grouped by **owner** (one section per agent registered in the `agents` table). Each card shows:
- Status icon + title + category badge
- **Project badge** (from `projectLookup` — links task to its parent project, if any)
- Description
- Estimated products, estimated time, difficulty
- Result summary (if completed)
- Error message (if failed)
- **Blocking indicator** (amber badge when status is `blocked`)
- **Message thread toggle** — expand/collapse the per-task conversation thread
- Action buttons: Approve, Reject, Mark Complete

### Message Thread (expanded)
When the thread toggle is clicked on a task card, a conversation panel appears showing all `task_messages` for that `task_key`, ordered chronologically. Each message shows:
- Sender name and type (agent or human)
- Timestamp
- Message body
- **Blocking badge** (if `is_blocking = true` and not yet resolved)
- **Resolve button** on unresolved blocking messages (human clicks to resolve)

A reply input at the bottom lets the human send a new message into the thread.

---

## Database Schema

### `task_queue` (task rows)
```sql
SELECT task_key, title, description, status, priority, owner, category,
       estimated_products, estimated_time, difficulty,
       result_summary, error_message, products_added,
       is_project, project_key,
       created_at, approved_at, started_at, completed_at, updated_at
FROM task_queue
WHERE is_project = false
ORDER BY priority ASC, created_at ASC;
```

| Column | Type | Notes |
|--------|------|-------|
| `task_key` | text | Unique identifier (e.g., `scrape-heart-soil`) |
| `title` | text | Display name |
| `description` | text | What to do |
| `status` | text | See lifecycle below |
| `priority` | int | 1-6, lower = higher priority |
| `owner` | text | Agent `name` from the `agents` table (e.g., `jeff`, `maureen`) |
| `category` | text | `scraping`, `pipeline`, `research`, `data_gaps`, `expansion`, etc. |
| `estimated_products` | int | Expected product count to add |
| `estimated_time` | text | Human-readable estimate |
| `difficulty` | text | `easy`, `medium`, `hard` |
| `result_summary` | text | Filled on completion |
| `error_message` | text | Filled on failure |
| `products_added` | int | Actual products added |
| `project_key` | text | Links to parent project (optional) |
| `approved_at` | timestamptz | When Kip approved |
| `started_at` | timestamptz | When agent started execution |
| `completed_at` | timestamptz | When finished |

### `agents` (dynamic agent registry)
```sql
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT,
  emoji TEXT NOT NULL DEFAULT '🤖',
  color TEXT NOT NULL DEFAULT 'cyan',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| Column | Type | Notes |
|--------|------|-------|
| `name` | text | Unique slug used as `owner` in `task_queue` (e.g., `jeff`) |
| `display_name` | text | Human-readable name shown in UI (e.g., `Jeff`) |
| `role` | text | Agent role description (e.g., `AI CTO`) |
| `emoji` | text | Emoji displayed on the agent selector pill |
| `color` | text | Tailwind color name for the pill and section headers |
| `status` | text | `active` or `inactive` — only active agents appear in the UI |

### `task_messages` (per-task threaded conversations)
```sql
CREATE TABLE IF NOT EXISTS task_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key TEXT NOT NULL,
  sender TEXT NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'agent' CHECK (sender_type IN ('agent', 'human')),
  message TEXT NOT NULL,
  is_blocking BOOLEAN NOT NULL DEFAULT false,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| Column | Type | Notes |
|--------|------|-------|
| `task_key` | text | Links message to a task in `task_queue` |
| `sender` | text | Agent `name` or human identifier |
| `sender_type` | text | `agent` or `human` |
| `message` | text | The message body |
| `is_blocking` | boolean | If `true`, this message blocks the task until resolved |
| `is_resolved` | boolean | Whether a blocking message has been answered/resolved |
| `resolved_by` | text | Who resolved it |
| `resolved_at` | timestamptz | When it was resolved |

### `ongoing_tasks` (background processes)
```sql
SELECT task_key, title, description, process_command, status,
       pid, started_at, paused_at, last_heartbeat,
       progress_current, progress_total, success_count, failure_count,
       log_file, config, created_at, updated_at
FROM ongoing_tasks
ORDER BY created_at ASC;
```

| Column | Type | Notes |
|--------|------|-------|
| `task_key` | text | Unique ID (e.g., `image-hunter`) |
| `status` | text | `running`, `paused`, `stopped` |
| `pid` | int | OS process ID |
| `progress_current` / `progress_total` | int | Progress tracking |
| `success_count` / `failure_count` | int | Outcome counters |
| `log_file` | text | Path to output log |
| `config` | jsonb | Task-specific configuration |

---

## Task Lifecycle

```
pending --> approved --> running --> complete
   |           |           |
rejected    failed      blocked ----> running (when unblocked)
```

### Status Definitions
| Status | Meaning | Who Sets It |
|--------|---------|-------------|
| `pending` | Awaiting review | Creator (agent or human) |
| `approved` | Greenlit for execution | Kip (via dashboard Approve button) |
| `running` | Currently executing | Agent (auto on pickup) |
| `blocked` | Waiting on human input (has unresolved blocking message) | Agent (via posting a blocking message) |
| `complete` | Successfully finished | Agent or human |
| `failed` | Error during execution | Agent (auto) |
| `rejected` | Won't do | Kip (via dashboard Reject button) |

### Auto-Execution Rules
- Agents check for `status = 'approved'` on their configured polling interval
- On pickup: set `status = 'running'`, `started_at = NOW()`
- On finish: set `status = 'complete'`, `completed_at = NOW()`, fill `result_summary`
- On error: set `status = 'failed'`, fill `error_message`
- On needing human input: post a blocking message to `task_messages`, set `status = 'blocked'`

### Blocking Question Workflow

1. Agent posts a message to `task_messages` with `is_blocking = true`
2. Agent sets the task's `status` to `blocked`
3. The dashboard shows the task with an amber blocking indicator and the thread auto-expands
4. Human reads the question, types a reply, and clicks **Resolve** on the blocking message
5. `resolveMessage()` marks the message as `is_resolved = true`, sets `resolved_by` and `resolved_at`
6. If no unresolved blocking messages remain on the task, the task status returns to `running`
7. Agent detects the status change and resumes execution

---

## Agent Registration

Agents register themselves dynamically in the `agents` table. The dashboard reads active agents to build the selector pills and group task cards.

### Self-registration (SQL)
```sql
INSERT INTO agents (name, display_name, role, emoji, color)
VALUES ('new-agent', 'New Agent', 'Specialist', '🔬', 'emerald')
ON CONFLICT (name) DO NOTHING;
```

### Existing agents
| Name | Display Name | Role | Emoji | Color |
|------|-------------|------|-------|-------|
| `jeff` | Jeff | AI CTO | context-dependent | cyan |
| `maureen` | Maureen | AI CMO | context-dependent | pink |

New agents can register at any time. They will appear in the agent selector pills and as a grouping section in the task list once they have at least one task.

---

## Creating a Task

### Via Supabase (agents)
```sql
INSERT INTO task_queue (
  task_key, title, description, owner, status, priority, category,
  estimated_products, estimated_time, difficulty
)
VALUES (
  'unique-task-key',
  'Task Title',
  'Detailed description of what to do',
  'jeff',
  'pending',
  2,
  'scraping',
  500,
  '2 hours',
  'medium'
);
```

### Required fields
- `task_key` — unique string identifier
- `title` — display name
- `owner` — agent `name` from the `agents` table
- `status` — start as `pending`

### Optional but recommended
- `description` — detailed instructions
- `priority` — defaults to medium if omitted
- `category` — helps with filtering
- `estimated_products` — for the dashboard counter
- `project_key` — links task to a parent project (shows as a project badge on the card)

---

## Completing a Task

### Agent completion (after executing)
```sql
UPDATE task_queue
SET status = 'complete',
    completed_at = NOW(),
    updated_at = NOW(),
    result_summary = 'Added 150 products from Heart & Soil',
    products_added = 150
WHERE task_key = 'scrape-heart-soil';
```

### Manual completion (via dashboard)
Click "Mark Complete" button. Optionally enter a result summary in the prompt dialog.

### Failed task
```sql
UPDATE task_queue
SET status = 'failed',
    completed_at = NOW(),
    updated_at = NOW(),
    error_message = 'CAPTCHA blocked after 50 products'
WHERE task_key = 'scrape-amazon-supplements';
```

---

## Posting Messages and Blocking Questions

### Post a non-blocking message (status update)
```sql
INSERT INTO task_messages (task_key, sender, sender_type, message)
VALUES ('scrape-heart-soil', 'jeff', 'agent', 'Scraped 50 of 200 products so far');
```

### Post a blocking question
```sql
INSERT INTO task_messages (task_key, sender, sender_type, message, is_blocking)
VALUES ('scrape-heart-soil', 'jeff', 'agent', 'Need clarification on rate limits', true);

UPDATE task_queue
SET status = 'blocked', updated_at = NOW()
WHERE task_key = 'scrape-heart-soil';
```

### Human replies to a thread (via dashboard)
The human types a reply in the message thread input and clicks Send. This inserts a row with `sender_type = 'human'`.

### Resolving a blocking message (via dashboard)
The human clicks the **Resolve** button on the blocking message. This calls `resolveMessage()`, which:
1. Sets `is_resolved = true`, `resolved_by`, and `resolved_at` on the message
2. Checks if there are remaining unresolved blocking messages on the task
3. If none remain, updates the task `status` back to `running`

---

## Ongoing Tasks (Background Processes)

The Ongoing sub-tab shows long-running background processes from the `ongoing_tasks` table.

### Dashboard controls
| Button | Action | DB Update |
|--------|--------|-----------|
| Pause | Suspend process | `status = 'paused'`, `paused_at = NOW()` |
| Resume | Continue process | `status = 'running'`, `paused_at = NULL` |
| Start | Begin stopped process | `status = 'running'` |
| Stop | Terminate process | `status = 'stopped'`, `pid = NULL` |

**Note:** The dashboard only updates the database status. Actual process control (kill, SIGSTOP, etc.) must happen server-side or via the executing agent.

### Message Threads on Ongoing Tasks

Ongoing tasks support the same message thread UI as regular tasks:

- **💬 badge** on each card shows total message count and blocking count
- Click the badge to expand/collapse the thread
- **Send** a message as Kip (human) — stored in `task_messages` with the ongoing task's `task_key`
- **🚫 Block** sends a blocking message and pauses the ongoing task (`status = 'paused'`)
- **✓ Resolve** on a blocking message resumes the task (`status = 'running'`) if no remaining blockers

#### Agent polling for ongoing task messages

Agents running ongoing processes should poll `task_messages` for their `task_key`, same as regular tasks:

```sql
-- Check for new human messages on your ongoing task
SELECT * FROM task_messages
WHERE task_key = 'social-media-daily-engagement'
  AND sender_type = 'human'
ORDER BY created_at DESC LIMIT 5;

-- Check for unresolved blocking messages (task is paused)
SELECT * FROM task_messages
WHERE task_key = 'social-media-daily-engagement'
  AND is_blocking = true AND is_resolved = false;
```

### Creating an ongoing task
```sql
INSERT INTO ongoing_tasks (task_key, title, description, process_command, status)
VALUES (
  'image-hunter',
  'Supplement Image Hunter',
  'Finds and downloads verified product images from multiple sources',
  'node src/huntImagesAllSources.js --limit=200',
  'stopped'
);
```

---

## What Agents Can Do

### Read
- List open tasks: `SELECT * FROM task_queue WHERE is_project = false AND status NOT IN ('complete', 'completed', 'rejected')`
- Check assigned work: `SELECT * FROM task_queue WHERE owner = 'jeff' AND status = 'approved'`
- Check blocked tasks: `SELECT * FROM task_queue WHERE owner = 'jeff' AND status = 'blocked'`
- Read thread messages: `SELECT * FROM task_messages WHERE task_key = 'some-task' ORDER BY created_at ASC`
- Check for resolved answers: `SELECT * FROM task_messages WHERE task_key = 'some-task' AND is_blocking = true AND is_resolved = true ORDER BY resolved_at DESC LIMIT 1`
- Monitor ongoing tasks: `SELECT * FROM ongoing_tasks`
- List active agents: `SELECT * FROM agents WHERE status = 'active'`

### Write
- **Self-register** as an agent (INSERT into `agents` with `ON CONFLICT DO NOTHING`)
- Create new tasks (INSERT into `task_queue` with `status = 'pending'`)
- Pick up approved tasks (UPDATE `status = 'running'`, `started_at = NOW()`)
- Complete tasks (UPDATE `status = 'complete'`, fill `result_summary`)
- Report failures (UPDATE `status = 'failed'`, fill `error_message`)
- Post messages to a task thread (INSERT into `task_messages`)
- Post blocking questions (INSERT into `task_messages` with `is_blocking = true`, UPDATE task `status = 'blocked'`)
- Resume after unblock (detect `status = 'running'` after human resolves blockers, continue execution)
- Update ongoing task progress (UPDATE `progress_current`, `success_count`, etc.)

### Task ownership
Agents are registered dynamically in the `agents` table. Any agent can own tasks. Common agents:

| Owner | Role | Typical categories |
|-------|------|-------------------|
| `jeff` | AI CTO | `scraping`, `pipeline`, `data_gaps`, `expansion` |
| `maureen` | AI CMO | `content`, `social`, `marketing` |
| `kip` | Human | Tasks requiring human action |

New agents register themselves and immediately become eligible to own tasks.

---

## Browser API

```javascript
// Reload task queue
window.loadTaskQueue();

// Switch filter tab
window.filterTasks('open');      // 'open', 'completed', 'ongoing', 'all'

// Filter tasks by agent
window.filterByAgent('jeff');    // Show only tasks owned by 'jeff'

// Approve a task (prompts for confirmation)
window.approveTask('task-key');

// Reject a task
window.rejectTask('task-key');

// Mark complete (prompts for result summary)
window.completeTask('task-key');

// Expand/collapse message thread on a task card
window.toggleThread('task-key');

// Send a message to a task thread (reads from the input field)
window.sendMessage('task-key');

// Resolve a blocking message (marks resolved, may unblock the task)
window.resolveMessage('message-uuid', 'task-key');

// Load ongoing tasks
window.loadOngoingTasks();
```

---

## Project Badge on Task Cards

When a task has a `project_key`, the card displays a **project badge** showing the parent project's title (resolved via `projectLookup`). This provides at-a-glance context for which project a task belongs to. Clicking the badge navigates to the Projects tab filtered to that project.

Project cards on the Projects tab also show **richer status aggregation** — they count tasks in each status (including `blocked`) and display a breakdown of pending, approved, running, blocked, and completed tasks for the project.
