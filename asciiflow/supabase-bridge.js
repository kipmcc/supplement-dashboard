/**
 * AviFlow — Supabase Bridge v3
 * Supabase-only storage. No local files.
 * Load: generates share URL → auto-forks into editable local drawing
 * Save: reads canvas state → writes to Supabase
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

async function listDiagrams(projectFilter) {
  let url = `${API}/diagrams?order=updated_at.desc&limit=100`;
  if (projectFilter) url += `&project_key=eq.${encodeURIComponent(projectFilter)}`;
  return (await fetch(url, { headers: HEADERS })).json();
}

async function loadDiagram(id) {
  const data = await (await fetch(`${API}/diagrams?id=eq.${id}`, { headers: HEADERS })).json();
  return data[0] || null;
}

async function saveDiagramToSupabase(id, title, content, projectKey, createdBy) {
  if (id) {
    // Save version first
    await fetch(`${API}/diagram_versions`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ diagram_id: id, content, saved_by: createdBy || 'dashboard' })
    });
    const vcRes = await fetch(`${API}/diagram_versions?diagram_id=eq.${id}&select=id`, { headers: HEADERS });
    const vCount = (await vcRes.json()).length;
    return (await fetch(`${API}/diagrams?id=eq.${id}`, {
      method: 'PATCH', headers: HEADERS,
      body: JSON.stringify({ title, content, project_key: projectKey || null,
        updated_at: new Date().toISOString(), version_count: vCount })
    })).json();
  } else {
    return (await fetch(`${API}/diagrams`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ title, content, project_key: projectKey || null,
        created_by: createdBy || 'dashboard', tags: [], version_count: 1 })
    })).json();
  }
}

async function renameDiagram(id, newTitle) {
  return (await fetch(`${API}/diagrams?id=eq.${id}`, {
    method: 'PATCH', headers: HEADERS,
    body: JSON.stringify({ title: newTitle, updated_at: new Date().toISOString() })
  })).json();
}

async function deleteDiagram(id) {
  await fetch(`${API}/diagram_versions?diagram_id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
  await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
}

async function listVersions(diagramId) {
  return (await fetch(`${API}/diagram_versions?diagram_id=eq.${diagramId}&order=created_at.desc&limit=30`, { headers: HEADERS })).json();
}

// ===================== ASCIIFlow Format Helpers =====================

function asciiToShareSpec(asciiText, name) {
  // Replicate DrawingStringifier.serialize:
  // 1. Layer.serialize: JSON {version:2, x:0, y:0, text}
  // 2. Drawing: JSON {name, layer: layerJsonString}
  // 3. Compress + base64
  const layerJson = JSON.stringify({ version: 2, x: 0, y: 0, text: asciiText });
  const drawingJson = JSON.stringify({ name: name || 'cloud', layer: layerJson });
  const jsonBytes = new TextEncoder().encode(drawingJson);
  const deflated = pako.deflate(jsonBytes);
  return Base64.fromUint8Array(deflated);
}

function shareSpecToAscii(spec) {
  try {
    const deflated = Base64.toUint8Array(spec);
    const jsonBytes = pako.inflate(deflated);
    const json = JSON.parse(new TextDecoder('utf8').decode(jsonBytes));
    const layer = JSON.parse(json.layer);
    return layer.text || '';
  } catch { return ''; }
}

function getCurrentCanvasAscii() {
  // Read from localStorage — ASCIIFlow writes committed-layer there
  const keys = Object.keys(localStorage).filter(k => k.includes('committed-layer'));
  for (const key of keys) {
    const val = localStorage.getItem(key);
    if (!val) continue;
    try {
      const layer = JSON.parse(val);
      if (layer.text && layer.text.trim()) return layer.text;
    } catch {}
  }
  return '';
}

// ===================== State =====================

let currentDiagramId = null;
let currentDiagramTitle = null;
let lastSavedContent = '';
let sidebarSection = null;

// Check URL params for pending load
const PENDING_LOAD_KEY = 'aviflow_pending_load';
const PENDING_META_KEY = 'aviflow_pending_meta';

// ===================== Sidebar Injection =====================

function injectIntoSidebar() {
  const interval = setInterval(() => {
    let sidebar = null;
    const allElements = document.querySelectorAll('div');
    for (const el of allElements) {
      if (el.offsetWidth > 200 && el.offsetWidth < 500 && el.offsetHeight > 400) {
        if ((el.textContent || '').includes('File') && (el.textContent || '').includes('Edit')) {
          sidebar = el;
          break;
        }
      }
    }
    if (sidebar) {
      clearInterval(interval);
      hideNativeSections(sidebar);
      createSidebarSection(sidebar);
      checkPendingLoad();
    }
  }, 500);
  setTimeout(() => clearInterval(interval), 10000);
}

function hideNativeSections(sidebar) {
  const muiList = sidebar.querySelector('ul.MuiList-root, ul[class*="MuiList"]');
  if (!muiList) return;
  const items = Array.from(muiList.children);
  let hideMode = null;
  for (const item of items) {
    const text = (item.textContent || '').trim();
    if (text === 'File' || text.startsWith('File')) { item.style.display = 'none'; hideMode = 'file'; continue; }
    if (hideMode === 'file') {
      if (text.startsWith('Edit') || item.querySelector('#aviflow-cloud')) { hideMode = null; }
      else { item.style.display = 'none'; continue; }
    }
    if (text === 'Help' || text.startsWith('Help')) { item.style.display = 'none'; hideMode = 'help'; continue; }
    if (hideMode === 'help') { item.style.display = 'none'; continue; }
  }
  for (const child of sidebar.children) {
    const text = (child.textContent || '').trim();
    if (text.startsWith('Draw boxes') || text.includes('cmd + z') || text.includes('Pan around')) child.style.display = 'none';
  }
}

// ===================== Auto-fork after share URL load =====================

function checkPendingLoad() {
  const pendingMeta = sessionStorage.getItem(PENDING_META_KEY);
  if (!pendingMeta) return;

  // We're on a share URL page — need to auto-fork
  const meta = JSON.parse(pendingMeta);
  currentDiagramId = meta.id;
  currentDiagramTitle = meta.title;
  lastSavedContent = meta.content;

  const titleEl = document.getElementById('af-title');
  const projEl = document.getElementById('af-project');
  if (titleEl) titleEl.value = meta.title || '';
  if (projEl) projEl.value = meta.project || '';

  // Look for Fork & Edit button and auto-click it
  const tryFork = () => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('FORK') || btn.textContent.includes('Fork')) {
        // First set the drawing name in the fork dialog input
        setTimeout(() => {
          const input = document.querySelector('input[type="text"]');
          if (input) {
            // Set value via native setter to trigger React state
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, meta.title || 'cloud');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          // Click the FORK button in the dialog
          setTimeout(() => {
            const dialogButtons = document.querySelectorAll('button');
            for (const db of dialogButtons) {
              if (db.textContent.trim() === 'FORK') {
                db.click();
                sessionStorage.removeItem(PENDING_META_KEY);
                // After fork, set viewport offset to near origin so content is visible
                setTimeout(() => {
                  const keys = Object.keys(localStorage).filter(k => k.includes('offset'));
                  // Set all drawing offsets to near origin
                  for (const key of keys) {
                    localStorage.setItem(key, JSON.stringify({x: -100, y: -50}));
                  }
                  // Also find any new drawing's offset key and set it
                  const drawingKeys = Object.keys(localStorage).filter(k => k.includes('committed-layer'));
                  for (const dk of drawingKeys) {
                    const offsetKey = dk.replace('committed-layer', 'offset');
                    localStorage.setItem(offsetKey, JSON.stringify({x: -100, y: -50}));
                    localStorage.setItem(dk.replace('committed-layer', 'zoom'), '1');
                  }
                  window.location.reload();
                }, 500);
                showMsg(`Loaded "${meta.title}"`, 'ok');
                return;
              }
            }
          }, 300);
        }, 300);
        btn.click();
        return true;
      }
    }
    return false;
  };

  // Try immediately, then retry a few times
  if (!tryFork()) {
    let attempts = 0;
    const retryInterval = setInterval(() => {
      if (tryFork() || ++attempts > 10) clearInterval(retryInterval);
    }, 500);
  }
}

// ===================== UI =====================

function createSidebarSection(sidebar) {
  if (sidebarSection) return;
  const section = document.createElement('div');
  section.id = 'aviflow-cloud';
  section.innerHTML = `
    <style>
      #aviflow-cloud {
        border-top: 2px solid #3b82f6;
        margin-top: 8px;
        padding: 12px 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #333;
      }
      #aviflow-cloud .af-hdr { font-weight:700; font-size:14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; color:#1f2937; }
      #aviflow-cloud .af-btn { padding:2px 8px; border-radius:3px; border:1px solid #d1d5db; background:#fff; cursor:pointer; font-size:10px; color:#374151; }
      #aviflow-cloud .af-btn:hover { background:#f3f4f6; }
      #aviflow-cloud .af-btn-blue { background:#3b82f6; color:#fff; border-color:#3b82f6; }
      #aviflow-cloud .af-btn-blue:hover { background:#2563eb; }
      #aviflow-cloud .af-btn-red { color:#dc2626; border-color:#fca5a5; }
      #aviflow-cloud .af-btn-red:hover { background:#fef2f2; }
      #aviflow-cloud .af-item { padding:8px 10px; margin-bottom:4px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; cursor:pointer; transition:all .15s; }
      #aviflow-cloud .af-item:hover { border-color:#3b82f6; background:#eff6ff; }
      #aviflow-cloud .af-item.active { border-color:#3b82f6; background:#dbeafe; }
      #aviflow-cloud .af-item-name { font-weight:600; font-size:13px; color:#1f2937; display:flex; justify-content:space-between; }
      #aviflow-cloud .af-item-meta { font-size:11px; color:#9ca3af; margin-top:2px; }
      #aviflow-cloud .af-item-actions { margin-top:4px; display:flex; gap:4px; }
      #aviflow-cloud .af-save { margin-top:10px; padding-top:10px; border-top:1px solid #e5e7eb; }
      #aviflow-cloud .af-save input { width:100%; padding:5px 8px; border:1px solid #d1d5db; border-radius:4px; font-size:12px; margin-bottom:6px; box-sizing:border-box; color:#1f2937; }
      #aviflow-cloud .af-save-btns { display:flex; gap:4px; }
      #aviflow-cloud .af-save-btns .af-btn { flex:1; padding:5px; font-size:11px; text-align:center; }
      #aviflow-cloud .af-status { font-size:11px; padding:4px 0; text-align:center; min-height:18px; }
      #aviflow-cloud .af-status.ok { color:#059669; }
      #aviflow-cloud .af-status.err { color:#dc2626; }
      #aviflow-cloud .af-empty { color:#9ca3af; text-align:center; padding:12px; font-size:12px; }
      #aviflow-cloud .af-filter input { width:100%; padding:4px 8px; border:1px solid #d1d5db; border-radius:4px; font-size:11px; box-sizing:border-box; color:#6b7280; margin-bottom:8px; }
    </style>
    <div class="af-hdr">☁️ Cloud Diagrams <button class="af-btn" onclick="window._af.refresh()">↻</button></div>
    <div class="af-filter"><input type="text" id="af-filter" placeholder="Filter by project..." oninput="window._af.refresh()" /></div>
    <div id="af-list"><div class="af-empty">Loading...</div></div>
    <div id="af-status" class="af-status"></div>
    <div class="af-save">
      <input type="text" id="af-title" placeholder="Diagram title..." />
      <input type="text" id="af-project" placeholder="Project (e.g. outpost)" />
      <div class="af-save-btns">
        <button class="af-btn af-btn-blue" onclick="window._af.save()">💾 Save</button>
        <button class="af-btn" onclick="window._af.saveNew()">➕ New</button>
        <button class="af-btn" onclick="window._af.copyMd()">📋 Copy</button>
      </div>
    </div>
    <div style="padding:8px 0 0;font-size:10px;color:#9ca3af;line-height:1.6;">
      <strong style="color:#6b7280;">Keys:</strong> ⌘Z undo · ⌘⇧Z redo · Space+drag pan · B box · V select · D freeform · A arrow · L line · T text
    </div>
  `;

  // Insert into MUI list between File and Edit
  const muiList = sidebar.querySelector('ul.MuiList-root, ul[class*="MuiList"]');
  let inserted = false;
  if (muiList) {
    for (const item of Array.from(muiList.children)) {
      if (item.textContent.trim().startsWith('Edit')) {
        const li = document.createElement('li');
        li.style.listStyle = 'none';
        li.appendChild(section);
        muiList.insertBefore(li, item);
        inserted = true;
        break;
      }
    }
  }
  if (!inserted) sidebar.appendChild(section);
  sidebarSection = section;
  refreshCloudList();
}

// ===================== List =====================

async function refreshCloudList() {
  const listEl = document.getElementById('af-list');
  if (!listEl) return;
  const filter = (document.getElementById('af-filter')?.value || '').trim();
  try {
    const diagrams = await listDiagrams(filter || null);
    if (!diagrams.length) { listEl.innerHTML = '<div class="af-empty">No diagrams yet. Draw and 💾 Save!</div>'; return; }
    listEl.innerHTML = diagrams.map(d => `
      <div class="af-item ${d.id === currentDiagramId ? 'active' : ''}" onclick="window._af.load('${d.id}')">
        <div class="af-item-name"><span>${esc(d.title)}</span><span style="font-size:10px;color:#9ca3af;">v${d.version_count||0}</span></div>
        <div class="af-item-meta">${d.project_key?`📁 ${esc(d.project_key)}`:''}${d.created_by?` · ${esc(d.created_by)}`:''}  · ${fmtDate(d.updated_at)}</div>
        <div class="af-item-actions">
          <button class="af-btn" onclick="event.stopPropagation();window._af.rename('${d.id}','${esc(d.title)}')">✏️</button>
          <button class="af-btn" onclick="event.stopPropagation();window._af.duplicate('${d.id}')">📑</button>
          <button class="af-btn af-btn-red" onclick="event.stopPropagation();window._af.del('${d.id}')">🗑</button>
        </div>
      </div>
    `).join('');
  } catch (e) { listEl.innerHTML = `<div class="af-empty" style="color:#dc2626;">Error: ${e.message}</div>`; }
}

// ===================== Handlers =====================

async function handleLoad(id) {
  const diagram = await loadDiagram(id);
  if (!diagram) { showMsg('Not found', 'err'); return; }

  // Store metadata in sessionStorage for after reload
  sessionStorage.setItem(PENDING_META_KEY, JSON.stringify({
    id: diagram.id, title: diagram.title,
    project: diagram.project_key || '', content: diagram.content
  }));

  // Generate share spec and navigate
  const spec = asciiToShareSpec(diagram.content, diagram.title);
  window.location.href = window.location.pathname + '#/share/' + encodeURIComponent(spec);
  window.location.reload();
}

async function handleSave() {
  const title = document.getElementById('af-title').value.trim() || 'Untitled';
  const project = document.getElementById('af-project').value.trim() || null;
  const ascii = getCurrentCanvasAscii();
  if (!ascii) { showMsg('Nothing to save — draw first!', 'err'); return; }
  const result = await saveDiagramToSupabase(currentDiagramId, title, ascii, project, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
    currentDiagramTitle = result[0].title;
    lastSavedContent = ascii;
  }
  showMsg(`Saved "${title}"`, 'ok');
  refreshCloudList();
}

async function handleSaveNew() {
  const title = document.getElementById('af-title').value.trim() || 'Untitled';
  const project = document.getElementById('af-project').value.trim() || null;
  const ascii = getCurrentCanvasAscii();
  if (!ascii) { showMsg('Nothing to save — draw first!', 'err'); return; }
  currentDiagramId = null;
  const result = await saveDiagramToSupabase(null, title, ascii, project, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
    currentDiagramTitle = result[0].title;
    lastSavedContent = ascii;
  }
  showMsg(`Created "${title}"`, 'ok');
  refreshCloudList();
}

function handleRename(id, currentTitle) {
  const newTitle = prompt('Rename diagram:', currentTitle || '');
  if (!newTitle || newTitle === currentTitle) return;
  renameDiagram(id, newTitle).then(() => {
    if (id === currentDiagramId) { currentDiagramTitle = newTitle; const t = document.getElementById('af-title'); if (t) t.value = newTitle; }
    showMsg(`Renamed to "${newTitle}"`, 'ok');
    refreshCloudList();
  });
}

async function handleDuplicate(id) {
  const d = await loadDiagram(id);
  if (!d) return;
  await saveDiagramToSupabase(null, `${d.title} (copy)`, d.content, d.project_key, 'dashboard');
  showMsg(`Duplicated "${d.title}"`, 'ok');
  refreshCloudList();
}

async function handleDelete(id) {
  if (!confirm('Delete this diagram and all versions?')) return;
  await deleteDiagram(id);
  if (currentDiagramId === id) { currentDiagramId = null; currentDiagramTitle = null; }
  showMsg('Deleted', 'ok');
  refreshCloudList();
}

function handleCopyMd() {
  const ascii = getCurrentCanvasAscii();
  if (!ascii) { showMsg('Nothing to copy', 'err'); return; }
  navigator.clipboard.writeText('```\n' + ascii + '\n```').then(
    () => showMsg('Copied as markdown!', 'ok'),
    () => showMsg('Copy failed', 'err')
  );
}

// ===================== Auto-save =====================

setInterval(() => {
  if (!currentDiagramId) return;
  const ascii = getCurrentCanvasAscii();
  if (ascii && ascii !== lastSavedContent) {
    const title = document.getElementById('af-title')?.value || currentDiagramTitle || 'Untitled';
    const project = document.getElementById('af-project')?.value || null;
    saveDiagramToSupabase(currentDiagramId, title, ascii, project, 'dashboard').then(() => {
      lastSavedContent = ascii;
      showMsg('Auto-saved', 'ok');
    }).catch(() => {});
  }
}, 30000);

// ===================== Helpers =====================

function showMsg(text, type) {
  const el = document.getElementById('af-status');
  if (el) { el.textContent = text; el.className = `af-status ${type||''}`; }
  setTimeout(() => { if (el) { el.textContent = ''; el.className = 'af-status'; } }, 3000);
}
function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') : ''; }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }

// ===================== Init =====================

window._af = {
  refresh: refreshCloudList,
  load: handleLoad,
  save: handleSave,
  saveNew: handleSaveNew,
  rename: handleRename,
  duplicate: handleDuplicate,
  del: handleDelete,
  copyMd: handleCopyMd,
};

window.addEventListener('DOMContentLoaded', () => {
  injectIntoSidebar();
});
