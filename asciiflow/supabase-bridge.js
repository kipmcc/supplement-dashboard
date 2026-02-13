/**
 * AviFlow — Supabase Bridge v5
 * Direct canvas integration via __aviflow_api (exposed from modified ASCIIFlow source).
 * Native Unicode box-drawing characters throughout.
 */

const SUPABASE_URL = 'https://xijsvdhffiuxpepswnyb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzU0NTYsImV4cCI6MjA4MTc1MTQ1Nn0.Y5igqaP-p4ZvvVP47xvy4SFCyZE030wyuITYIUwWlRI';

const COLOR_NAMES = {
  '#E53E3E': 'red', '#3182CE': 'blue', '#38A169': 'green',
  '#DD6B20': 'orange', '#805AD5': 'purple',
};
const API = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// ===================== Supabase API =====================

async function apiList(projectFilter) {
  let url = `${API}/diagrams?order=updated_at.desc&limit=100`;
  if (projectFilter) url += `&project_key=eq.${encodeURIComponent(projectFilter)}`;
  return (await fetch(url, { headers: HEADERS })).json();
}

async function apiGet(id) {
  const data = await (await fetch(`${API}/diagrams?id=eq.${id}`, { headers: HEADERS })).json();
  return data[0] || null;
}

async function apiSave(id, title, content, projectKey, createdBy) {
  if (id) {
    await fetch(`${API}/diagram_versions`, { method: 'POST', headers: HEADERS,
      body: JSON.stringify({ diagram_id: id, content, saved_by: createdBy || 'dashboard' }) });
    const vc = await (await fetch(`${API}/diagram_versions?diagram_id=eq.${id}&select=id`, { headers: HEADERS })).json();
    return (await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'PATCH', headers: HEADERS,
      body: JSON.stringify({ title, content, project_key: projectKey || null,
        updated_at: new Date().toISOString(), version_count: vc.length }) })).json();
  }
  return (await fetch(`${API}/diagrams`, { method: 'POST', headers: HEADERS,
    body: JSON.stringify({ title, content, project_key: projectKey || null,
      created_by: createdBy || 'dashboard', tags: [], version_count: 1 }) })).json();
}

async function apiRename(id, newTitle) {
  return (await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'PATCH', headers: HEADERS,
    body: JSON.stringify({ title: newTitle, updated_at: new Date().toISOString() }) })).json();
}

async function apiDelete(id) {
  await fetch(`${API}/diagram_versions?diagram_id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
  await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
}

async function apiSetLocked(id, locked) {
  return (await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'PATCH', headers: HEADERS,
    body: JSON.stringify({ locked: !!locked, updated_at: new Date().toISOString() }) })).json();
}

// ===================== Canvas API =====================

function loadToCanvas(text) {
  if (window.__aviflow_api) {
    window.__aviflow_api.loadText(text);
    topLeftJustify();
    return true;
  }
  console.error('AviFlow API not available');
  return false;
}

/**
 * Position viewport so content starts at the top-left of the visible canvas area.
 * ASCIIFlow coordinate system:
 *   screen_pos = translate(canvasW/2, canvasH/2) + (gridPos * charSize - offset)
 * Content at grid (0,0) appears at screen center when offset=(0,0).
 * To put grid (0,0) at the top-left visible area (accounting for sidebar):
 *   we need offset.x = -(canvasW/2 - sidebarW - padding)
 * But offset can't meaningfully go negative in ASCIIFlow's model, so we use
 * a small positive offset that accounts for the translate.
 */
function topLeftJustify() {
  const canvas = window.__aviflow_store?.currentCanvas;
  if (!canvas) return;
  // Place content at top-left of visible area
  // The translate shifts everything by (canvasW/2, canvasH/2).
  // Cell (0,0) at offset (ox, oy) appears at screen (canvasW/2 - ox, canvasH/2 - oy).
  // We want it near top-left of visible area: (sidebarW + pad, pad)
  // So: canvasW/2 - ox = sidebarW + pad  =>  ox = canvasW/2 - sidebarW - pad
  // And: canvasH/2 - oy = pad  =>  oy = canvasH/2 - pad
  const sidebarOpen = !document.body.classList.contains('sidebar-collapsed');
  const sidebarW = sidebarOpen ? 380 : 0;
  const pad = 20;
  const cw = document.documentElement.clientWidth;
  const ch = document.documentElement.clientHeight;
  const ox = cw / 2 - sidebarW - pad;
  const oy = ch / 2 - pad;
  canvas.setOffset({ x: Math.max(0, ox), y: Math.max(0, oy) });
  canvas.setZoom(1);
}

function readFromCanvas() {
  if (window.__aviflow_api) return window.__aviflow_api.getText() || '';
  return '';
}

// ===================== State =====================

let currentId = null;
let currentTitle = null;
let currentProject = null;
let currentLocked = false;
let lastSaved = '';

// ===================== UI =====================

function injectUI() {
  const interval = setInterval(() => {
    let sidebar = null;
    for (const el of document.querySelectorAll('div')) {
      if (el.offsetWidth > 200 && el.offsetWidth < 500 && el.offsetHeight > 400 &&
          (el.textContent||'').includes('File') && (el.textContent||'').includes('Edit')) {
        sidebar = el; break;
      }
    }
    if (sidebar) {
      clearInterval(interval);
      hideNative(sidebar);
      buildPanel(sidebar);
      refreshList();
    }
  }, 500);
  setTimeout(() => clearInterval(interval), 10000);
}

function hideNative(sidebar) {
  const ul = sidebar.querySelector('ul.MuiList-root, ul[class*="MuiList"]');
  if (!ul) return;
  let mode = null;
  for (const item of Array.from(ul.children)) {
    const t = (item.textContent||'').trim();
    if (t === 'File' || t.startsWith('File')) { item.style.display = 'none'; mode = 'file'; continue; }
    if (mode === 'file') { if (t.startsWith('Edit') || item.querySelector('#af-cloud')) { mode = null; } else { item.style.display = 'none'; continue; } }
    if (t === 'Help' || t.startsWith('Help')) { item.style.display = 'none'; mode = 'help'; continue; }
    if (mode === 'help') { item.style.display = 'none'; continue; }
  }
  for (const ch of sidebar.children) {
    const t = (ch.textContent||'').trim();
    if (t.startsWith('Draw boxes') || t.includes('cmd + z') || t.includes('Pan around')) ch.style.display = 'none';
  }
}

function buildPanel(sidebar) {
  const sec = document.createElement('div');
  sec.id = 'af-cloud';
  sec.innerHTML = `<style>
#af-cloud{padding:4px 12px 6px;font-family:SF Mono,Menlo,Consolas,monospace;font-size:12px;color:#ccc;margin-top:0}
#af-cloud .btn{padding:3px 8px;border-radius:3px;border:1px solid #555;background:#333;cursor:pointer;font-size:11px;color:#ccc}
#af-cloud .btn:hover{background:#4a5568;border-color:#666}
#af-cloud .btn:disabled{opacity:.35;cursor:default;pointer-events:none}
#af-cloud .btn-b{background:#2563eb;color:#fff;border-color:#2563eb}
#af-cloud .btn-b:hover{background:#1d4ed8}
#af-cloud .flt input{width:100%;padding:4px 8px;border:1px solid #555;border-radius:3px;font-size:11px;box-sizing:border-box;background:#2d2d2d;color:#ccc;font-family:inherit}
#af-cloud .flt input::placeholder{color:#777}
#af-cloud #af-lst{max-height:150px;overflow-y:auto;margin:4px 0;scrollbar-width:thin;scrollbar-color:#555 transparent}
#af-cloud #af-lst::-webkit-scrollbar{width:5px}
#af-cloud #af-lst::-webkit-scrollbar-thumb{background:#555;border-radius:3px}
#af-cloud .itm{padding:4px 8px;border:none;border-radius:3px;cursor:pointer;transition:background .1s;display:flex;justify-content:space-between;align-items:center;background:transparent;color:#ccc;border-left:2px solid transparent;font-size:12px;line-height:1.4}
#af-cloud .itm:hover{background:#444}
#af-cloud .itm.on{background:#4a5568;color:#fff;border-left-color:#60a5fa}
#af-cloud .itm .ver{font-size:10px;color:#777;margin-left:6px;flex-shrink:0}
#af-cloud .itm.on .ver{color:#93c5fd}
#af-cloud .detail{padding:3px 8px;font-size:11px;color:#888;border-top:1px solid #444;border-bottom:1px solid #444;margin:2px 0;min-height:14px;line-height:1.4}
#af-cloud .detail .dl-proj{color:#aaa}
#af-cloud .detail .dl-date{color:#666}
#af-cloud .sts{font-size:11px;padding:1px 0;text-align:center;min-height:14px;color:#888}
#af-cloud .sts.ok{color:#34d399}
#af-cloud .sts.err{color:#f87171}
#af-cloud .emp{color:#666;text-align:center;padding:10px;font-size:11px}
#af-cloud .toolbar{display:flex;gap:4px;align-items:center;padding:2px 0}
#af-cloud .toolbar .tl{display:flex;gap:4px}
#af-cloud .toolbar .tr{display:flex;gap:3px;margin-left:auto}
#af-cloud .cbtn{background:none;border:1px solid transparent;border-radius:50%;cursor:pointer;font-size:14px;padding:2px 4px;color:#ccc}
#af-cloud .cbtn.active{border-color:#fff;background:rgba(255,255,255,0.15)}
</style>
<div class="flt" style="display:flex;gap:4px;align-items:center"><input id="af-flt" placeholder="Filter by project..." oninput="_af.refresh()" style="flex:1"/><button class="btn" onclick="_af.refresh()" title="Refresh diagram list">🔄</button></div>
<div id="af-lst"><div class="emp">Loading...</div></div>
<div id="af-detail" class="detail"></div>
<div id="af-sts" class="sts"></div>
<div class="toolbar">
  <div class="tl">
    <button class="btn btn-b" onclick="_af.save()" title="Save current diagram">💾 Save</button>
    <button class="btn" onclick="_af.saveNew()" title="Create new diagram">+ New</button>
  </div>
  <div class="tr">
    <button id="af-btn-lock" class="btn" onclick="_af.toggleLock()" title="Toggle lock" disabled>🔓</button>
    <button id="af-btn-rename" class="btn" onclick="_af.rename()" title="Rename selected diagram" disabled>✏️</button>
    <button id="af-btn-dup" class="btn" onclick="_af.dup()" title="Duplicate selected diagram" disabled>📑</button>
    <button id="af-btn-del" class="btn" onclick="_af.del()" title="Delete selected diagram" disabled>🗑</button>
    <button class="btn" onclick="_af.copy()" title="Copy as markdown to clipboard">📋</button>
    <button class="btn" onclick="_af.clearCanvas()" title="Clear entire canvas (undoable)">🧹</button>
  </div>
</div>
<div class="toolbar" style="border-top:1px solid #444;padding-top:3px">
  <div class="tl">
    <button class="btn" onclick="_af.zoomOut()" title="Zoom out">−</button>
    <span id="af-zoom" style="min-width:36px;text-align:center;font-size:11px;color:#888">100%</span>
    <button class="btn" onclick="_af.zoomIn()" title="Zoom in">+</button>
  </div>
  <div class="tr">
    <button class="btn" onclick="_af.centerContent()" title="Center diagram in view (keep zoom)">Center</button>
    <button class="btn" onclick="_af.fitContent()" title="Fit diagram to screen (adjust zoom)">Fit</button>
    <button class="btn" onclick="_af.topLeft()" title="Reset to origin at 100%">⌂</button>
  </div>
</div>
<div class="toolbar" style="border-top:1px solid #444;padding-top:3px">
  <div class="tl" style="gap:4px;align-items:center">
    <span style="font-size:10px;color:#888">Color:</span>
    <button class="cbtn active" data-color="" onclick="_af.setColor(this)" title="Default">\u2B24</button>
    <button class="cbtn" data-color="#E53E3E" onclick="_af.setColor(this)" title="Red" style="color:#E53E3E">\u2B24</button>
    <button class="cbtn" data-color="#3182CE" onclick="_af.setColor(this)" title="Blue" style="color:#3182CE">\u2B24</button>
    <button class="cbtn" data-color="#38A169" onclick="_af.setColor(this)" title="Green" style="color:#38A169">\u2B24</button>
    <button class="cbtn" data-color="#DD6B20" onclick="_af.setColor(this)" title="Orange" style="color:#DD6B20">\u2B24</button>
    <button class="cbtn" data-color="#805AD5" onclick="_af.setColor(this)" title="Purple" style="color:#805AD5">\u2B24</button>
  </div>
  <div class="tr">
    <button class="btn" onclick="_af.insertRow()" title="Insert blank row (shift down)">\u25BC+</button>
    <button class="btn" onclick="_af.deleteRow()" title="Delete row (shift up)">\u25B2\u2212</button>
  </div>
</div>
<div style="padding:2px 0 0;font-size:10px;color:#666;line-height:1.3">
  <b style="color:#888">Keys:</b> \u2318Z undo \u00B7 \u2318\u21E7Z redo \u00B7 Scroll pan \u00B7 B box \u00B7 V select \u00B7 D freeform \u00B7 A arrow \u00B7 L line \u00B7 T text \u00B7 E erase
</div>`;

  const ul = sidebar.querySelector('ul.MuiList-root, ul[class*="MuiList"]');
  let inserted = false;
  if (ul) {
    for (const item of Array.from(ul.children)) {
      if (item.textContent.trim().startsWith('Edit')) {
        const li = document.createElement('li');
        li.style.listStyle = 'none';
        li.appendChild(sec);
        ul.insertBefore(li, item);
        inserted = true;
        break;
      }
    }
  }
  if (!inserted) sidebar.appendChild(sec);
}

// ===================== List =====================

let _diagrams = []; // cached list for detail lookups

async function refreshList() {
  const el = document.getElementById('af-lst');
  if (!el) return;
  const flt = (document.getElementById('af-flt')?.value||'').trim();
  try {
    const ds = await apiList(flt||null);
    _diagrams = ds;
    if (!ds.length) { el.innerHTML = '<div class="emp">No diagrams yet. Draw and 💾 Save!</div>'; updateDetail(); return; }
    el.innerHTML = ds.map(d => {
      const sel = d.id === currentId;
      const indicator = sel ? '▸ ' : '  ';
      const lockIcon = d.locked ? '🔒 ' : '';
      return `<div class="itm ${sel?'on':''}" onclick="_af.load('${d.id}')">${indicator}${lockIcon}${esc(d.title)}<span class="ver">v${d.version_count||1}</span></div>`;
    }).join('');
    updateDetail();
  } catch(e) { el.innerHTML = `<div class="emp" style="color:#f87171">Error: ${e.message}</div>`; }
}

// ===================== Detail bar =====================

function updateDetail() {
  const el = document.getElementById('af-detail');
  if (!el) return;
  const hasSel = !!currentId;
  // Enable/disable toolbar buttons
  for (const id of ['af-btn-rename','af-btn-dup','af-btn-del','af-btn-lock']) {
    const b = document.getElementById(id);
    if (b) b.disabled = !hasSel;
  }
  // Update lock button icon
  const lockBtn = document.getElementById('af-btn-lock');
  if (lockBtn) lockBtn.textContent = currentLocked ? '🔒' : '🔓';
  // Disable rename+delete when locked
  if (currentLocked) {
    const renBtn = document.getElementById('af-btn-rename');
    const delBtn = document.getElementById('af-btn-del');
    if (renBtn) renBtn.disabled = true;
    if (delBtn) delBtn.disabled = true;
  }
  if (!hasSel) { el.innerHTML = '<span style="color:#555">No file selected</span>'; return; }
  const d = _diagrams.find(x => x.id === currentId);
  const proj = (d?.project_key || currentProject) ? `<span class="dl-proj">📁 ${esc(d?.project_key || currentProject)}</span>` : '';
  const author = d?.created_by ? ` · ${esc(d.created_by)}` : '';
  const date = d?.updated_at ? `<div class="dl-date">${fmt(d.updated_at)}</div>` : '';
  const lockBadge = currentLocked ? ' <span style="color:#f59e0b">🔒 Locked</span>' : '';
  el.innerHTML = `<div>${proj}${author}${lockBadge}</div>${date}`;
}

// ===================== Handlers =====================

async function doLoad(id) {
  const d = await apiGet(id);
  if (!d) { msg('Not found','err'); return; }
  // Parse content — may be JSON with colors or plain text
  let text, colors;
  try {
    const parsed = JSON.parse(d.content);
    if (parsed.text !== undefined) {
      text = parsed.text;
      colors = parsed.colors || {};
    } else {
      text = d.content;
      colors = {};
    }
  } catch { text = d.content; colors = {}; }
  if (!loadToCanvas(text)) { msg('Canvas API not ready — try refreshing','err'); return; }
  // Apply colors
  const canvas = window.__aviflow_store?.currentCanvas;
  if (canvas && colors && Object.keys(colors).length > 0) {
    for (const [k, v] of Object.entries(colors)) {
      canvas.committed.colorMap.set(k, v);
    }
  }
  currentId = d.id;
  currentTitle = d.title;
  currentProject = d.project_key || null;
  currentLocked = !!d.locked;
  window.__aviflow_store?.locked?.set(currentLocked);
  lastSaved = d.content;
  msg(`Loaded "${d.title}"`, 'ok');
  refreshList();
}

async function doSave() {
  if (currentId && currentLocked) { msg('Diagram is locked','err'); return; }
  const ascii = readFromCanvas();
  if (!ascii) { msg('Nothing to save — draw first!','err'); return; }
  // Use stored title/project for existing diagrams, prompt for new
  let title = currentTitle || 'Untitled';
  let proj = currentProject;
  if (!currentId) {
    title = prompt('Diagram title:', 'Untitled') || 'Untitled';
    proj = prompt('Project key (optional):', '') || null;
  }
  // Get color data from committed layer
  const canvas = window.__aviflow_store?.currentCanvas;
  const colors = {};
  if (canvas?.committed?.colorMap?.size > 0) {
    for (const [k, v] of canvas.committed.colorMap.entries()) {
      colors[k] = v;
    }
  }
  const content = Object.keys(colors).length > 0
    ? JSON.stringify({ text: ascii, colors })
    : ascii; // Keep plain text if no colors (backward compat)
  const r = await apiSave(currentId, title, content, proj, 'dashboard');
  if (Array.isArray(r) && r[0]) {
    currentId = r[0].id;
    currentTitle = r[0].title;
    currentProject = r[0].project_key || null;
    lastSaved = content;
  }
  msg(`Saved "${title}"`,'ok');
  refreshList();
}

async function doSaveNew() {
  currentId = null;
  currentTitle = null;
  currentProject = null;
  currentLocked = false;
  window.__aviflow_store?.locked?.set(false);
  await doSave();
}

function doRename(id, cur) {
  const rid = id || currentId;
  const rcur = cur || currentTitle;
  if (!rid) return;
  if (currentLocked && rid === currentId) { msg('Diagram is locked','err'); return; }
  const n = prompt('Rename:', rcur||'');
  if (!n || n === rcur) return;
  apiRename(rid, n).then(() => {
    if (rid === currentId) currentTitle = n;
    msg(`Renamed to "${n}"`,'ok');
    refreshList();
  });
}

async function doDup(id) {
  const did = id || currentId;
  if (!did) return;
  const d = await apiGet(did);
  if (!d) return;
  await apiSave(null, d.title+' (copy)', d.content, d.project_key, 'dashboard');
  msg(`Duplicated "${d.title}"`,'ok');
  refreshList();
}

async function doDel(id) {
  const did = id || currentId;
  if (!did) return;
  if (currentLocked && did === currentId) { msg('Diagram is locked','err'); return; }
  if (!confirm('Delete this diagram and all versions?')) return;
  await apiDelete(did);
  if (currentId === did) {
    currentId = null; currentTitle = null; currentProject = null; currentLocked = false;
    window.__aviflow_store?.locked?.set(false);
    lastSaved = '';
    const canvas = window.__aviflow_store?.currentCanvas;
    if (canvas) canvas.clear();
  }
  msg('Deleted','ok');
  refreshList();
}

function doCopy() {
  const ascii = readFromCanvas();
  if (!ascii) { msg('Nothing to copy','err'); return; }
  navigator.clipboard.writeText('```\n'+ascii+'\n```').then(
    () => msg('Copied as markdown!','ok'), () => msg('Copy failed','err'));
}

// ===================== Auto-save =====================

setInterval(() => {
  if (!currentId) return;
  if (currentLocked) return;
  const ascii = readFromCanvas();
  if (!ascii) return;
  // Build content with colors
  const canvas = window.__aviflow_store?.currentCanvas;
  const colors = {};
  if (canvas?.committed?.colorMap?.size > 0) {
    for (const [k, v] of canvas.committed.colorMap.entries()) {
      colors[k] = v;
    }
  }
  const content = Object.keys(colors).length > 0
    ? JSON.stringify({ text: ascii, colors })
    : ascii;
  if (content !== lastSaved) {
    const title = currentTitle || 'Untitled';
    const proj = currentProject;
    apiSave(currentId, title, content, proj, 'dashboard').then(() => { lastSaved = content; msg('Auto-saved','ok'); }).catch(()=>{});
  }
}, 30000);

// ===================== Diagram Scrub =====================

/**
 * Scrub a diagram to fix alignment issues:
 * 1. Ensure all rows in the same box have consistent width (right edges align)
 * 2. Fix disconnected corners where horizontal and vertical lines don't meet
 * 3. Remove trailing whitespace inconsistencies
 */
function scrubDiagram(text) {
  if (!text) return text;
  let lines = text.split('\n');

  // Remove trailing whitespace from each line
  lines = lines.map(l => l.trimEnd());

  // Remove empty trailing lines
  while (lines.length && !lines[lines.length - 1]) lines.pop();

  // Find the maximum content width
  const maxW = Math.max(...lines.map(l => l.length));

  // Pad all lines to uniform width (needed for consistent box edges)
  lines = lines.map(l => l.padEnd(maxW));

  // Build a grid for analysis
  const grid = lines.map(l => [...l]);
  const H = grid.length;
  const W = maxW;

  function at(r,c) { return (r>=0 && r<H && c>=0 && c<W) ? grid[r][c] : ' '; }
  function isH(ch) { return '─━'.includes(ch); }
  function isV(ch) { return '│┃'.includes(ch); }
  function isCorner(ch) { return '┌┐└┘├┤┬┴┼'.includes(ch); }
  function isStructural(ch) { return isH(ch) || isV(ch) || isCorner(ch); }

  // Pass 1: Fix corners that should connect but don't
  // Look for patterns like: ─ [space] │ where the space should be a corner
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r][c] !== ' ') continue;

      const up = isV(at(r-1,c)) || isCorner(at(r-1,c));
      const down = isV(at(r+1,c)) || isCorner(at(r+1,c));
      const left = isH(at(r,c-1)) || isCorner(at(r,c-1));
      const right = isH(at(r,c+1)) || isCorner(at(r,c+1));

      // Only fill if it would create a valid junction (at least 2 connections)
      const connections = [up, down, left, right].filter(Boolean).length;
      if (connections >= 2) {
        if (down && right && !up && !left) grid[r][c] = '┌';
        else if (down && left && !up && !right) grid[r][c] = '┐';
        else if (up && right && !down && !left) grid[r][c] = '└';
        else if (up && left && !down && !right) grid[r][c] = '┘';
        else if (up && down && right && !left) grid[r][c] = '├';
        else if (up && down && left && !right) grid[r][c] = '┤';
        else if (down && left && right && !up) grid[r][c] = '┬';
        else if (up && left && right && !down) grid[r][c] = '┴';
        else if (up && down && left && right) grid[r][c] = '┼';
      }
    }
  }

  // Rebuild text, trim trailing spaces
  return grid.map(r => r.join('').trimEnd()).join('\n');
}

function doScrub() {
  if (currentLocked) { msg('Diagram is locked','err'); return; }
  const ascii = readFromCanvas();
  if (!ascii) { msg('Nothing to scrub', 'err'); return; }
  // Preserve colors before scrub
  const canvas = window.__aviflow_store?.currentCanvas;
  const savedColors = {};
  if (canvas?.committed?.colorMap?.size > 0) {
    for (const [k, v] of canvas.committed.colorMap.entries()) {
      savedColors[k] = v;
    }
  }
  const scrubbed = scrubDiagram(ascii);
  loadToCanvas(scrubbed);
  // Re-apply colors
  if (canvas && Object.keys(savedColors).length > 0) {
    for (const [k, v] of Object.entries(savedColors)) {
      canvas.committed.colorMap.set(k, v);
    }
  }
  msg('Diagram scrubbed (colors preserved)', 'ok');
}

// ===================== Clear Canvas =====================

function doClearCanvas() {
  if (currentLocked) { msg('Diagram is locked','err'); return; }
  const canvas = window.__aviflow_store?.currentCanvas;
  if (!canvas) return;
  if (canvas.committed.size() === 0) { msg('Canvas is empty', 'err'); return; }
  canvas.clear();
  msg('Canvas cleared (⌘Z to undo)', 'ok');
}

// ===================== Zoom Controls =====================

function doZoomIn() {
  const c = window.__aviflow_store?.currentCanvas;
  if (!c) return;
  c.setZoom(Math.min(c.zoom * 1.25, 5));
  updateZoomDisplay();
}

function doZoomOut() {
  const c = window.__aviflow_store?.currentCanvas;
  if (!c) return;
  c.setZoom(Math.max(c.zoom / 1.25, 0.2));
  updateZoomDisplay();
}

function doFitContent() {
  const canvas = window.__aviflow_store?.currentCanvas;
  if (!canvas) return;
  const keys = canvas.committed.keys();
  if (!keys.length) { msg('Nothing to fit', 'err'); return; }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) {
    if (k.x < minX) minX = k.x;
    if (k.y < minY) minY = k.y;
    if (k.x > maxX) maxX = k.x;
    if (k.y > maxY) maxY = k.y;
  }

  const CW = 9, CH = 16, PAD = 40;
  const contentW = (maxX - minX + 2) * CW;
  const contentH = (maxY - minY + 2) * CH;

  const sidebarOpen = !document.body.classList.contains('sidebar-collapsed');
  const sidebarW = sidebarOpen ? 380 : 0;
  const viewW = document.documentElement.clientWidth - sidebarW;
  const viewH = document.documentElement.clientHeight;

  const zoom = Math.min((viewW - PAD) / contentW, (viewH - PAD) / contentH, 2);

  const fcx = ((minX + maxX) / 2) * CW;
  const fcy = ((minY + maxY) / 2) * CH;

  canvas.setZoom(Math.max(zoom, 0.2));
  canvas.setOffset({ x: fcx - sidebarW / (2 * zoom), y: fcy });
  updateZoomDisplay();
}

function doCenterContent() {
  const canvas = window.__aviflow_store?.currentCanvas;
  if (!canvas) return;
  const keys = canvas.committed.keys();
  if (!keys.length) { msg('Nothing to center', 'err'); return; }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) {
    if (k.x < minX) minX = k.x;
    if (k.y < minY) minY = k.y;
    if (k.x > maxX) maxX = k.x;
    if (k.y > maxY) maxY = k.y;
  }

  const CW = 9, CH = 16;
  const fcx = ((minX + maxX) / 2) * CW;
  const fcy = ((minY + maxY) / 2) * CH;

  // Offset so content center appears at visible-area center (keeping current zoom)
  const sidebarOpen = !document.body.classList.contains('sidebar-collapsed');
  const sidebarW = sidebarOpen ? 380 : 0;
  const zoom = canvas.zoom;
  canvas.setOffset({ x: fcx - sidebarW / (2 * zoom), y: fcy });
}

function updateZoomDisplay() {
  const el = document.getElementById('af-zoom');
  const c = window.__aviflow_store?.currentCanvas;
  if (el && c) el.textContent = Math.round(c.zoom * 100) + '%';
}

setInterval(updateZoomDisplay, 500);

// ===================== Helpers =====================

function msg(text, type) {
  const el = document.getElementById('af-sts');
  if (el) { el.textContent = text; el.className = 'sts '+(type||''); }
  setTimeout(() => { if (el) { el.textContent = ''; el.className = 'sts'; } }, 3000);
}
function esc(s) { return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):''; }
function fmt(iso) { if(!iso)return''; const d=new Date(iso); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }

// ===================== Color Palette =====================

function doSetColor(btn) {
  document.querySelectorAll('#af-cloud .cbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const color = btn.dataset.color || null;
  window.__aviflow_api?.setColor(color);

  // If there's an active selection, recolor those cells immediately
  const canvas = window.__aviflow_store?.currentCanvas;
  const sel = canvas?.selection?.get?.();
  if (sel && color) {
    const tl = sel.topLeft();
    const br = sel.bottomRight();
    window.__aviflow_api.recolorRegion(tl.x, tl.y, br.x, br.y, color);
    msg('Recolored selection \u2192 ' + (COLOR_NAMES[color] || 'default'), 'ok');
  }
}

// ===================== Insert / Delete Row =====================

function doInsertRow() {
  if (currentLocked) { msg('Diagram is locked','err'); return; }
  const canvas = window.__aviflow_store?.currentCanvas;
  if (!canvas) return;
  const sel = canvas.selection.get();
  let y;
  if (sel) {
    y = sel.topLeft().y;
  } else {
    // Use viewport center Y
    const offset = canvas.offset;
    y = Math.round(offset.y / 16);
  }
  window.__aviflow_api.insertRow(y);
  msg('Row inserted at Y=' + y + ' (\u2318Z to undo)', 'ok');
}

function doDeleteRow() {
  if (currentLocked) { msg('Diagram is locked','err'); return; }
  const canvas = window.__aviflow_store?.currentCanvas;
  if (!canvas) return;
  const sel = canvas.selection.get();
  let y;
  if (sel) {
    y = sel.topLeft().y;
  } else {
    const offset = canvas.offset;
    y = Math.round(offset.y / 16);
  }
  window.__aviflow_api.deleteRow(y);
  msg('Row deleted at Y=' + y + ' (\u2318Z to undo)', 'ok');
}

// ===================== Lock Toggle =====================

async function doToggleLock() {
  if (!currentId) return;
  const newLocked = !currentLocked;
  const r = await apiSetLocked(currentId, newLocked);
  if (Array.isArray(r) && r[0]) {
    currentLocked = !!r[0].locked;
    window.__aviflow_store?.locked?.set(currentLocked);
    msg(currentLocked ? 'Locked' : 'Unlocked', 'ok');
    updateDetail();
  }
}

// ===================== Init =====================

window._af = { refresh: refreshList, load: doLoad, save: doSave, saveNew: doSaveNew,
  rename: doRename, dup: doDup, del: doDel, copy: doCopy, scrub: doScrub,
  topLeft: topLeftJustify, clearCanvas: doClearCanvas,
  zoomIn: doZoomIn, zoomOut: doZoomOut, fitContent: doFitContent,
  centerContent: doCenterContent,
  setColor: doSetColor, insertRow: doInsertRow, deleteRow: doDeleteRow,
  toggleLock: doToggleLock };

window.addEventListener('DOMContentLoaded', injectUI);
