# AviFlow Diagram Creation Guide — For AI Agents

*How to programmatically create, save, and manage diagrams in AviFlow.*

---

## Quick Reference

```javascript
// Load diagram into canvas
window.__aviflow_api.loadText(diagramString);
_af.topLeft(); // position viewport

// Read current canvas content
window.__aviflow_api.getText();

// Save via Supabase bridge
_af.save();     // save current (prompts if new — avoid in automation)
_af.saveNew();  // force new save (prompts — avoid in automation)
```

For automation, use the direct Supabase API (see below).

---

## Direct Supabase API — No Prompts

### Create a new diagram

```javascript
const SUPABASE_URL = 'https://xijsvdhffiuxpepswnyb.supabase.co';
const SUPABASE_ANON_KEY = '<anon key from supabase-bridge.js>';
const HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

const content = window.__aviflow_api.getText();
const resp = await fetch(`${SUPABASE_URL}/rest/v1/diagrams`, {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify({
    title: 'My Diagram Title',       // Required — descriptive name
    content: content,                 // The ASCII text from canvas
    project_key: 'outpost',           // Optional — groups diagrams by project
    created_by: 'claude',             // Who created it (agent name)
    tags: ['architecture', 'v1'],     // Optional — array of tags
    version_count: 1
  })
});
const result = await resp.json();
const diagramId = result[0].id;       // UUID for future updates
```

### Update an existing diagram

```javascript
// Save a version snapshot first
await fetch(`${SUPABASE_URL}/rest/v1/diagram_versions`, {
  method: 'POST', headers: HEADERS,
  body: JSON.stringify({ diagram_id: id, content, saved_by: 'claude' })
});

// Then update the diagram
await fetch(`${SUPABASE_URL}/rest/v1/diagrams?id=eq.${id}`, {
  method: 'PATCH', headers: HEADERS,
  body: JSON.stringify({
    content,
    updated_at: new Date().toISOString(),
    version_count: newVersionCount
  })
});

// Refresh the sidebar
_af.refresh();
```

### Load a diagram from Supabase

```javascript
_af.load('diagram-uuid-here');
```

### CLI / curl — create diagrams from outside the browser

```bash
SUPABASE_URL='https://xijsvdhffiuxpepswnyb.supabase.co'
ANON_KEY='<anon key from supabase-bridge.js>'

curl -X POST "${SUPABASE_URL}/rest/v1/diagrams" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "title": "My Diagram",
    "content": "┌──────────┐\n│  Hello   │\n└──────────┘",
    "project_key": "dashboard",
    "created_by": "claude",
    "tags": [],
    "version_count": 1
  }'
```

Hit 🔄 Refresh in the sidebar (or `_af.refresh()`) to see the new diagram appear.

### Sidebar operations (via `window._af`)

| Function | Args | Notes |
|----------|------|-------|
| `_af.save()` | none | Save current canvas (prompts for title if new) |
| `_af.saveNew()` | none | Force create new diagram (prompts for title) |
| `_af.load(id)` | uuid | Load diagram into canvas, select in sidebar |
| `_af.rename()` | none | Rename selected diagram (prompts for new name) |
| `_af.dup()` | none | Duplicate selected diagram |
| `_af.del()` | none | Delete selected diagram (prompts for confirmation) |
| `_af.copy()` | none | Copy canvas as markdown to clipboard |
| `_af.refresh()` | none | Refresh diagram list from Supabase |
| `_af.topLeft()` | none | Reposition viewport to show content at top-left |

---

## Diagram Schema (Supabase `diagrams` table)

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | auto | Primary key |
| `title` | text | yes | Displayed in sidebar |
| `content` | text | yes | The ASCII diagram text |
| `project_key` | text | no | Groups diagrams (e.g., `outpost`, `dashboard`) |
| `created_by` | text | no | Agent or user name (e.g., `claude`, `maureen`) |
| `tags` | jsonb | no | Array of strings |
| `version_count` | int | no | Incremented on save |
| `created_at` | timestamp | auto | |
| `updated_at` | timestamp | auto | Update on save |

---

## Building Properly Aligned Diagrams

**The #1 rule: every line must be exactly the same width.** Mismatched widths cause the right edge to break visually.

### Use a programmatic builder

```javascript
const W = 52; // inner width (chars between the │ borders)

function r(content) {
  // Pads content to exact width, truncates if too long
  return '│' + content.padEnd(W).slice(0, W) + '│';
}

const lines = [
  '┌' + '─'.repeat(W) + '┐',          // top border
  r('  Title of Diagram'),              // content row
  '├' + '─'.repeat(W) + '┤',          // horizontal divider
  r('  Content here'),                  // content row
  '└' + '─'.repeat(W) + '┘',          // bottom border
];
```

### Multi-column layouts

```javascript
const C1 = 16, C2 = 16;
const C3 = W - C1 - C2 - 2; // subtract 2 for the │ dividers

// Column divider row
'├' + '─'.repeat(C1) + '┬' + '─'.repeat(C2) + '┬' + '─'.repeat(C3) + '┤'

// Content row — use r() for the outer borders, embed │ for column dividers
r('  Col 1 content │  Col 2 content │  Col 3 content')
//  ^— must total exactly W chars including the inner │ characters

// Merge columns back
'├' + '─'.repeat(C1) + '┴' + '─'.repeat(C2) + '┴' + '─'.repeat(C3) + '┤'
```

### Always validate before loading

```javascript
const bad = lines.filter(l => l.length !== W + 2);
if (bad.length) throw new Error('Misaligned: ' + JSON.stringify(
  lines.map((l,i) => ({i, w: l.length})).filter(x => x.w !== W + 2)
));
window.__aviflow_api.loadText(lines.join('\n'));
_af.topLeft();
```

---

## Box-Drawing Character Reference

### Characters and their connections

| Char | Name | Connects |
|------|------|----------|
| `─` | horizontal | left, right |
| `│` | vertical | up, down |
| `┌` | top-left corner | right, down |
| `┐` | top-right corner | left, down |
| `└` | bottom-left corner | right, up |
| `┘` | bottom-right corner | left, up |
| `├` | left tee | up, down, right |
| `┤` | right tee | up, down, left |
| `┬` | top tee | left, right, down |
| `┴` | bottom tee | left, right, up |
| `┼` | cross | all four |

### Arrow characters

| Char | Direction |
|------|-----------|
| `►` or `▶` | right arrow (use with `──►`) |
| `◄` or `◀` | left arrow |
| `▲` | up arrow |
| `▼` | down arrow |

---

## Common Patterns

### Simple box

```
┌────────────┐
│  Box Title │
│  Content   │
└────────────┘
```

### Box with sections

```
┌────────────┐
│   Header   │
├────────────┤
│  Content   │
└────────────┘
```

### Connected boxes (horizontal)

```
┌──────┐     ┌──────┐     ┌──────┐
│ Box1 │────►│ Box2 │────►│ Box3 │
└──────┘     └──────┘     └──────┘
```

### Connected boxes (vertical)

```
┌──────┐
│ Box1 │
└──┬───┘
   │
┌──┴───┐
│ Box2 │
└──────┘
```

### Nested boxes in columns

```
┌────────────────┬────────────────┐
│   Column A     │   Column B     │
├────────────────┼────────────────┤
│ ┌────────────┐ │ ┌────────────┐ │
│ │ Inner Box  │ │ │ Inner Box  │ │
│ └────────────┘ │ └────────────┘ │
└────────────────┴────────────────┘
```

---

## Checklist Before Saving

1. **Every line same length** — validate programmatically
2. **Inner boxes fit within columns** — account for ` │ ` borders consuming chars
3. **Title and project_key set** — makes diagrams discoverable in sidebar
4. **`created_by` set** — tracks who/what created it
5. **Content round-trips** — load → getText() → compare to original
