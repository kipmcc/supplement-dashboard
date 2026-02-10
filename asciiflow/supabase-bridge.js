/**
 * AviFlow — Supabase Bridge v4
 * Direct canvas integration via __aviflow_api (exposed from modified ASCIIFlow source).
 * No localStorage hacks, no share URLs, no forking.
 */

const SUPABASE_URL = 'https://xijsvdhffiuxpepswnyb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzU0NTYsImV4cCI6MjA4MTc1MTQ1Nn0.Y5igqaP-p4ZvvVP47xvy4SFCyZE030wyuITYIUwWlRI';
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

// ===================== Canvas API (via modified ASCIIFlow) =====================

function loadToCanvas(text) {
  if (window.__aviflow_api) {
    window.__aviflow_api.loadText(text);
    centerOnContent(text);
    return true;
  }
  console.error('AviFlow API not available — ASCIIFlow bundle may not be modified');
  return false;
}

/**
 * Center the viewport on the loaded content.
 * ASCIIFlow grid: 2000×600 chars. Content loaded at grid origin (0,0) maps to
 * pixel center (MAX_GRID_WIDTH/2 * CHAR_H, MAX_GRID_HEIGHT/2 * CHAR_V).
 * We compute the content's center in grid coords, then convert to pixel offset.
 */
function centerOnContent(text) {
  const canvas = window.__aviflow_store?.currentCanvas;
  if (!canvas) return;
  const CHAR_H = 9, CHAR_V = 16;
  const GRID_W = 2000, GRID_H = 600;
  // Default center offset (what ASCIIFlow uses for empty canvas)
  const defaultX = (GRID_W * CHAR_H) / 2;
  const defaultY = (GRID_H * CHAR_V) / 2;

  if (!text || !text.trim()) {
    canvas.setOffset({x: defaultX, y: defaultY});
    canvas.setZoom(1);
    return;
  }
  // Compute content bounds from text lines
  const lines = text.split('\n');
  let maxCol = 0;
  let rowCount = lines.length;
  for (const line of lines) if (line.length > maxCol) maxCol = line.length;

  // Content center in grid coordinates (relative to origin 0,0)
  const centerCol = maxCol / 2;
  const centerRow = rowCount / 2;

  // Get the viewport size in pixels (approximate from window)
  const sidebarW = 360; // approximate sidebar width
  const vpW = window.innerWidth - sidebarW;
  const vpH = window.innerHeight;

  // Pixel offset = default center + (content grid center * char size) - (viewport / 2)
  // This positions the content center in the middle of the viewport
  const offsetX = defaultX + (centerCol * CHAR_H) - (vpW / 2);
  const offsetY = defaultY + (centerRow * CHAR_V) - (vpH / 2);

  canvas.setOffset({x: Math.max(0, offsetX), y: Math.max(0, offsetY)});
  canvas.setZoom(1);
}

function readFromCanvas() {
  if (window.__aviflow_api) return window.__aviflow_api.getText() || '';
  return '';
}

// ===================== State =====================

let currentId = null;
let currentTitle = null;
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
#af-cloud{border-top:2px solid #3b82f6;margin-top:8px;padding:12px 16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;color:#333}
#af-cloud .hdr{font-weight:700;font-size:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
#af-cloud .btn{padding:2px 8px;border-radius:3px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:10px;color:#374151}
#af-cloud .btn:hover{background:#f3f4f6}
#af-cloud .btn-b{background:#3b82f6;color:#fff;border-color:#3b82f6}
#af-cloud .btn-b:hover{background:#2563eb}
#af-cloud .btn-r{color:#dc2626;border-color:#fca5a5}
#af-cloud .btn-r:hover{background:#fef2f2}
#af-cloud .itm{padding:8px 10px;margin-bottom:4px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;transition:all .15s}
#af-cloud .itm:hover{border-color:#3b82f6;background:#eff6ff}
#af-cloud .itm.on{border-color:#3b82f6;background:#dbeafe}
#af-cloud .nm{font-weight:600;font-size:13px;display:flex;justify-content:space-between}
#af-cloud .mt{font-size:11px;color:#9ca3af;margin-top:2px}
#af-cloud .acts{margin-top:4px;display:flex;gap:4px}
#af-cloud .sav{margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb}
#af-cloud .sav input{width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;margin-bottom:6px;box-sizing:border-box}
#af-cloud .sav-btns{display:flex;gap:4px}
#af-cloud .sav-btns .btn{flex:1;padding:5px;font-size:11px;text-align:center}
#af-cloud .sts{font-size:11px;padding:4px 0;text-align:center;min-height:18px}
#af-cloud .sts.ok{color:#059669}
#af-cloud .sts.err{color:#dc2626}
#af-cloud .emp{color:#9ca3af;text-align:center;padding:12px;font-size:12px}
#af-cloud .flt input{width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;box-sizing:border-box;margin-bottom:8px}
</style>
<div class="hdr">☁️ Cloud Diagrams <button class="btn" onclick="_af.refresh()">↻</button></div>
<div class="flt"><input id="af-flt" placeholder="Filter by project..." oninput="_af.refresh()"/></div>
<div id="af-lst"><div class="emp">Loading...</div></div>
<div id="af-sts" class="sts"></div>
<div class="sav">
  <input id="af-t" placeholder="Diagram title..."/>
  <input id="af-p" placeholder="Project (e.g. outpost)"/>
  <div class="sav-btns">
    <button class="btn btn-b" onclick="_af.save()">💾 Save</button>
    <button class="btn" onclick="_af.saveNew()">➕ New</button>
    <button class="btn" onclick="_af.copy()">📋 Copy</button>
  </div>
</div>
<div style="padding:8px 0 0;font-size:10px;color:#9ca3af;line-height:1.6">
  <b style="color:#6b7280">Keys:</b> ⌘Z undo · ⌘⇧Z redo · Space+drag pan · B box · V select · D freeform · A arrow · L line · T text
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

async function refreshList() {
  const el = document.getElementById('af-lst');
  if (!el) return;
  const flt = (document.getElementById('af-flt')?.value||'').trim();
  try {
    const ds = await apiList(flt||null);
    if (!ds.length) { el.innerHTML = '<div class="emp">No diagrams yet. Draw and 💾 Save!</div>'; return; }
    el.innerHTML = ds.map(d => `
      <div class="itm ${d.id===currentId?'on':''}" onclick="_af.load('${d.id}')">
        <div class="nm"><span>${esc(d.title)}</span><span style="font-size:10px;color:#9ca3af">v${d.version_count||0}</span></div>
        <div class="mt">${d.project_key?'📁 '+esc(d.project_key):''}${d.created_by?' · '+esc(d.created_by):''} · ${fmt(d.updated_at)}</div>
        <div class="acts">
          <button class="btn" onclick="event.stopPropagation();_af.rename('${d.id}','${esc(d.title)}')">✏️</button>
          <button class="btn" onclick="event.stopPropagation();_af.dup('${d.id}')">📑</button>
          <button class="btn btn-r" onclick="event.stopPropagation();_af.del('${d.id}')">🗑</button>
        </div>
      </div>`).join('');
  } catch(e) { el.innerHTML = `<div class="emp" style="color:#dc2626">Error: ${e.message}</div>`; }
}

// ===================== Handlers =====================

async function doLoad(id) {
  const d = await apiGet(id);
  if (!d) { msg('Not found','err'); return; }
  if (!loadToCanvas(d.content)) { msg('Canvas API not ready — try refreshing','err'); return; }
  currentId = d.id;
  currentTitle = d.title;
  lastSaved = d.content;
  const t = document.getElementById('af-t');
  const p = document.getElementById('af-p');
  if (t) t.value = d.title;
  if (p) p.value = d.project_key || '';
  msg(`Loaded "${d.title}"`, 'ok');
  refreshList();
}

async function doSave() {
  const title = (document.getElementById('af-t')?.value||'').trim() || 'Untitled';
  const proj = (document.getElementById('af-p')?.value||'').trim() || null;
  const ascii = readFromCanvas();
  if (!ascii) { msg('Nothing to save — draw first!','err'); return; }
  const r = await apiSave(currentId, title, ascii, proj, 'dashboard');
  if (Array.isArray(r) && r[0]) { currentId = r[0].id; currentTitle = r[0].title; lastSaved = ascii; }
  msg(`Saved "${title}"`,'ok');
  refreshList();
}

async function doSaveNew() {
  currentId = null;
  await doSave();
}

function doRename(id, cur) {
  const n = prompt('Rename:', cur||'');
  if (!n || n === cur) return;
  apiRename(id, n).then(() => {
    if (id === currentId) { currentTitle = n; const t = document.getElementById('af-t'); if (t) t.value = n; }
    msg(`Renamed to "${n}"`,'ok');
    refreshList();
  });
}

async function doDup(id) {
  const d = await apiGet(id);
  if (!d) return;
  await apiSave(null, d.title+' (copy)', d.content, d.project_key, 'dashboard');
  msg(`Duplicated "${d.title}"`,'ok');
  refreshList();
}

async function doDel(id) {
  if (!confirm('Delete this diagram and all versions?')) return;
  await apiDelete(id);
  if (currentId === id) { currentId = null; currentTitle = null; }
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
  const ascii = readFromCanvas();
  if (ascii && ascii !== lastSaved) {
    const title = document.getElementById('af-t')?.value || currentTitle || 'Untitled';
    const proj = document.getElementById('af-p')?.value || null;
    apiSave(currentId, title, ascii, proj, 'dashboard').then(() => { lastSaved = ascii; msg('Auto-saved','ok'); }).catch(()=>{});
  }
}, 30000);

// ===================== Helpers =====================

function msg(text, type) {
  const el = document.getElementById('af-sts');
  if (el) { el.textContent = text; el.className = 'sts '+(type||''); }
  setTimeout(() => { if (el) { el.textContent = ''; el.className = 'sts'; } }, 3000);
}
function esc(s) { return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):''; }
function fmt(iso) { if(!iso)return''; const d=new Date(iso); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }

// ===================== Init =====================

window._af = { refresh: refreshList, load: doLoad, save: doSave, saveNew: doSaveNew,
  rename: doRename, dup: doDup, del: doDel, copy: doCopy };

window.addEventListener('DOMContentLoaded', injectUI);
