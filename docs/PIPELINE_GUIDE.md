# Pipeline Tab Guide — For AI Agents

*How to read and interact with the Content Pipeline tab.*

*Last updated: 2026-02-14*

---

## Purpose

The Pipeline tab provides a **bird's-eye view of all task activity** plus content pipeline health. It shows:
- Task queue distribution (by priority, category, status)
- Content queue status
- Review queue (pending/approved/failed counts)
- Published content metrics
- Pipeline health (success rate, throughput, avg completion time)
- Recent pipeline activity feed

---

## UI Layout

### Summary Cards (top row)
| Card | Source |
|------|--------|
| Pipeline Tasks | Total `task_queue` rows (where `is_project = false`) |
| Running | Status = `running` |
| Completed | Status = `completed` or `complete` |
| Failed | Status = `failed` |
| Success Rate | `completed / (completed + failed) * 100` |

### Two-Column Grid
| Section | What it shows |
|---------|---------------|
| Queue Overview | Tasks grouped by priority and category |
| Generation Status | Status distribution as progress bars + content queue breakdown |
| Review Queue | Pending/approved/failed summary cards + pending task list |
| Published Content | Content items + digest articles counts + by-source breakdown |

### Pipeline Health
Three metric cards:
- **Success Rate** — completed / (completed + failed)
- **Avg Days to Complete** — mean time from `created_at` to `completed_at`
- **Completed This Week** — tasks completed in last 7 days

### Recent Pipeline Tasks
Shows the 10 most recently updated tasks with category = `pipeline` (falls back to all tasks if none exist).

---

## Database Tables Used

### `task_queue` (primary source)
All task data — same table as the Tasks tab, but Pipeline views it holistically.
```sql
-- Pipeline aggregation queries
SELECT status, COUNT(*) FROM task_queue WHERE is_project = false GROUP BY status;
SELECT category, COUNT(*) FROM task_queue WHERE is_project = false GROUP BY category;
SELECT priority, COUNT(*) FROM task_queue WHERE is_project = false GROUP BY priority;
```

### `content_queue`
Content items for the publishing pipeline.
```sql
SELECT status, content_type, platform, title, published_at,
       requires_approval, approved_at
FROM content_queue
ORDER BY created_at DESC;
```

| Column | Type | Notes |
|--------|------|-------|
| `status` | text | `draft`, `scheduled`, `published`, `failed` |
| `content_type` | text | Article type |
| `platform` | text | Publishing platform |
| `requires_approval` | bool | Needs human review |
| `approved_at` | timestamptz | When approved |

### `longevity_content`
Captured content from social/web sources.
```sql
SELECT title, source, topic, content, captured_at
FROM longevity_content
ORDER BY captured_at DESC;
```

### `longevity_digest_articles`
Compiled digest articles.
```sql
SELECT title, created_at
FROM longevity_digest_articles
ORDER BY created_at DESC;
```

---

## Pipeline Health Calculations

### Success Rate
```javascript
const successRate = (completed + failed) > 0
  ? Math.round((completed / (completed + failed)) * 100) + '%'
  : 'N/A';
```

### Average Completion Time
```javascript
const avgDays = tasks
  .filter(t => t.completed_at && t.created_at)
  .map(t => (new Date(t.completed_at) - new Date(t.created_at)) / (1000*60*60*24))
  .reduce((sum, d, _, arr) => sum + d / arr.length, 0)
  .toFixed(1);
```

### Weekly Throughput
```sql
SELECT COUNT(*) FROM task_queue
WHERE completed_at > NOW() - INTERVAL '7 days';
```

---

## What Agents Can Do

### Read
- Check pipeline health metrics to report on operational velocity
- Identify bottlenecks (high pending count, low success rate)
- Review content queue status
- Track published content volume

### Write
- Create content queue items: `INSERT INTO content_queue ...`
- Update content status: `UPDATE content_queue SET status = 'published' ...`
- Add longevity content: `INSERT INTO longevity_content ...`
- Add digest articles: `INSERT INTO longevity_digest_articles ...`

### Useful queries
```sql
-- Tasks stuck in approved (not picked up)
SELECT task_key, title, approved_at
FROM task_queue
WHERE status = 'approved'
  AND approved_at < NOW() - INTERVAL '1 hour';

-- Category-level success rates
SELECT category,
  COUNT(*) FILTER (WHERE status IN ('complete','completed')) as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('complete','completed')) /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('complete','completed','failed')), 0), 1) as pct
FROM task_queue
WHERE is_project = false
GROUP BY category;

-- Content queue pending review
SELECT * FROM content_queue
WHERE requires_approval = true AND approved_at IS NULL;
```

---

## Browser API

```javascript
// Reload pipeline tab
window.loadPipeline();
```

---

## Relationship to Tasks Tab

The Pipeline tab reads from the **same `task_queue` table** as the Tasks tab. The difference:
- **Tasks tab** — operational view for creating/approving/completing individual tasks
- **Pipeline tab** — analytical view showing aggregate health, throughput, and trends

Changes made via the Tasks tab (approve, complete, etc.) are immediately reflected in Pipeline on next refresh.
