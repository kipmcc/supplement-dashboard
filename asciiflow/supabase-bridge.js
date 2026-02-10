/**
 * AviFlow — Supabase Bridge
 * Save/load/rename/version/list diagrams backed by Supabase.
 * Tables: diagrams, diagram_versions
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

// ===================== API Functions =====================

async function listDiagrams(projectFilter) {
  let url = `${API}/diagrams?order=updated_at.desc&limit=100`;
  if (projectFilter) url += `&project_key=eq.${encodeURIComponent(projectFilter)}`;
  const res = await fetch(url, { headers: HEADERS });
  return res.json();
}

async function loadDiagram(id) {
  const res = await fetch(`${API}/diagrams?id=eq.${id}`, { headers: HEADERS });
  const data = await res.json();
  return data[0] || null;
}

async function saveDiagram(id, title, content, projectKey, createdBy, tags) {
  if (id) {
    // Save version snapshot before updating
    await saveVersion(id, content, createdBy || 'dashboard');
    const res = await fetch(`${API}/diagrams?id=eq.${id}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({
        title, content,
        project_key: projectKey || null,
        updated_at: new Date().toISOString(),
        version_count: await getVersionCount(id) + 1,
        ...(tags ? { tags } : {})
      })
    });
    return res.json();
  } else {
    const res = await fetch(`${API}/diagrams`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        title, content,
        project_key: projectKey || null,
        created_by: createdBy || 'dashboard',
        tags: tags || [],
        version_count: 1
      })
    });
    return res.json();
  }
}

async function renameDiagram(id, newTitle) {
  const res = await fetch(`${API}/diagrams?id=eq.${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ title: newTitle, updated_at: new Date().toISOString() })
  });
  return res.json();
}

async function deleteDiagram(id) {
  // Delete versions first
  await fetch(`${API}/diagram_versions?diagram_id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
  await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
}

// ===================== Version Functions =====================

async function saveVersion(diagramId, content, savedBy) {
  await fetch(`${API}/diagram_versions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ diagram_id: diagramId, content, saved_by: savedBy || 'dashboard' })
  });
}

async function getVersionCount(diagramId) {
  const res = await fetch(`${API}/diagram_versions?diagram_id=eq.${diagramId}&select=id`, { headers: HEADERS });
  const data = await res.json();
  return data.length;
}

async function listVersions(diagramId) {
  const res = await fetch(`${API}/diagram_versions?diagram_id=eq.${diagramId}&order=created_at.desc&limit=30`, { headers: HEADERS });
  return res.json();
}

// ===================== Canvas Integration =====================

function getCurrentDrawingText() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('drawing/'));
  const committedKey = keys.find(k => k.includes('committed-layer'));
  if (!committedKey) return '';
  return localStorage.getItem(committedKey) || '';
}

function getCurrentDrawingName() {
  const hash = window.location.hash;
  const match = hash.match(/\/local\/([^/]+)/);
  if (match) return decodeURIComponent(match[1]);
  return 'default';
}

function setCanvasContent(content) {
  const drawingName = getCurrentDrawingName();
  const prefix = `drawing/${encodeURIComponent(`local/${encodeURIComponent(drawingName)}`)}`;
  localStorage.setItem(`${prefix}/committed-layer`, content);
  localStorage.setItem(`${prefix}/undo-layers`, '[]');
  localStorage.setItem(`${prefix}/redo-layers`, '[]');
}

// ===================== UI State =====================

let currentDiagramId = null;
let currentDiagramTitle = null;
let panelVisible = false;
let panelView = 'list'; // 'list' | 'versions'
let projectFilter = '';
let autoSaveEnabled = true;
let lastSavedContent = '';
let statusTimeout = null;

// ===================== UI Creation =====================

function createPanel() {
  const panel = document.createElement('div');
  panel.id = 'aviflow-panel';
  panel.innerHTML = `
    <style>
      #aviflow-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 340px;
        height: 100vh;
        background: #111827;
        color: #e5e7eb;
        border-left: 2px solid #3b82f6;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        display: none;
        flex-direction: column;
        overflow: hidden;
        box-shadow: -4px 0 20px rgba(0,0,0,0.4);
      }
      #aviflow-panel.visible { display: flex; }
      .af-header {
        padding: 12px 16px;
        background: #1f2937;
        border-bottom: 1px solid #374151;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .af-header-title { font-weight: 700; font-size: 14px; }
      .af-tabs {
        display: flex;
        border-bottom: 1px solid #374151;
        background: #1f2937;
      }
      .af-tab {
        flex: 1;
        padding: 8px;
        text-align: center;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        color: #9ca3af;
        background: none;
        border-top: none;
        border-left: none;
        border-right: none;
      }
      .af-tab:hover { color: #e5e7eb; }
      .af-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }
      .af-body { flex: 1; overflow-y: auto; padding: 10px; }
      .af-status {
        padding: 6px 12px;
        font-size: 11px;
        color: #6b7280;
        border-top: 1px solid #1f2937;
        text-align: center;
        min-height: 24px;
      }
      .af-status.success { color: #10b981; }
      .af-status.error { color: #ef4444; }
      .af-filter {
        padding: 8px 10px;
        display: flex;
        gap: 6px;
      }
      .af-filter input, .af-filter select {
        flex: 1;
        padding: 5px 8px;
        background: #0f172a;
        border: 1px solid #374151;
        border-radius: 4px;
        color: #e5e7eb;
        font-size: 12px;
      }
      .af-item {
        padding: 10px 12px;
        margin-bottom: 6px;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .af-item:hover { border-color: #3b82f6; background: #1e293b; }
      .af-item.active { border-color: #3b82f6; background: #172554; }
      .af-item-title {
        font-weight: 600;
        margin-bottom: 3px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .af-item-meta { font-size: 11px; color: #6b7280; }
      .af-item-actions {
        margin-top: 6px;
        display: flex;
        gap: 4px;
      }
      .af-btn {
        padding: 4px 10px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        transition: background 0.15s;
      }
      .af-btn-sm { padding: 2px 8px; font-size: 10px; }
      .af-btn-primary { background: #3b82f6; color: white; }
      .af-btn-primary:hover { background: #2563eb; }
      .af-btn-secondary { background: #374151; color: #e5e7eb; }
      .af-btn-secondary:hover { background: #4b5563; }
      .af-btn-danger { background: #7f1d1d; color: #fca5a5; }
      .af-btn-danger:hover { background: #991b1b; }
      .af-btn-success { background: #065f46; color: #6ee7b7; }
      .af-btn-success:hover { background: #047857; }
      .af-save-section {
        padding: 10px 12px;
        border-top: 1px solid #374151;
        background: #1f2937;
      }
      .af-save-section input {
        width: 100%;
        padding: 6px 10px;
        background: #0f172a;
        border: 1px solid #374151;
        border-radius: 4px;
        color: #e5e7eb;
        font-size: 12px;
        margin-bottom: 6px;
        box-sizing: border-box;
      }
      .af-save-buttons {
        display: flex;
        gap: 6px;
      }
      .af-save-buttons .af-btn { flex: 1; padding: 7px 10px; font-size: 12px; }
      .af-current {
        padding: 8px 12px;
        background: #172554;
        border-bottom: 1px solid #374151;
        font-size: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .af-current-name { font-weight: 600; color: #93c5fd; }
      .af-version-item {
        padding: 8px 10px;
        margin-bottom: 4px;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 4px;
        cursor: pointer;
      }
      .af-version-item:hover { border-color: #3b82f6; }
      .af-version-meta { font-size: 11px; color: #6b7280; }
      .af-version-preview {
        font-family: monospace;
        font-size: 9px;
        white-space: pre;
        max-height: 60px;
        overflow: hidden;
        color: #6b7280;
        margin-top: 4px;
        line-height: 1.1;
      }
      #aviflow-toggle {
        position: fixed;
        top: 8px;
        right: 12px;
        z-index: 10000;
        padding: 6px 14px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      #aviflow-toggle:hover { background: #2563eb; }
      .af-empty {
        text-align: center;
        padding: 30px 20px;
        color: #6b7280;
        line-height: 1.6;
      }
    </style>

    <div class="af-header">
      <span class="af-header-title">☁️ AviFlow Diagrams</span>
      <button class="af-btn af-btn-secondary" onclick="togglePanel()" style="padding:2px 8px;">✕</button>
    </div>

    <div id="af-current-bar" class="af-current" style="display:none;">
      <span>📄 <span id="af-current-name" class="af-current-name"></span></span>
      <span style="display:flex;gap:4px;">
        <button class="af-btn af-btn-sm af-btn-secondary" onclick="handleRename()">✏️</button>
        <button class="af-btn af-btn-sm af-btn-secondary" onclick="switchView('versions')">📜</button>
      </span>
    </div>

    <div class="af-tabs">
      <button class="af-tab active" id="af-tab-list" onclick="switchView('list')">📁 All Diagrams</button>
      <button class="af-tab" id="af-tab-versions" onclick="switchView('versions')">📜 History</button>
    </div>

    <div class="af-filter">
      <input type="text" id="af-filter-project" placeholder="Filter by project..." oninput="handleFilterChange()" />
    </div>

    <div class="af-body" id="af-body"></div>

    <div id="af-status" class="af-status"></div>

    <div class="af-save-section">
      <input type="text" id="af-save-title" placeholder="Diagram title..." />
      <input type="text" id="af-save-project" placeholder="Project key (e.g. outpost)" />
      <div class="af-save-buttons">
        <button class="af-btn af-btn-primary" onclick="handleSave()">💾 Save</button>
        <button class="af-btn af-btn-secondary" onclick="handleSaveNew()">➕ New</button>
        <button class="af-btn af-btn-success" onclick="handleExportMarkdown()">📋 Copy</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Toggle button
  const toggle = document.createElement('button');
  toggle.id = 'aviflow-toggle';
  toggle.textContent = '☁️ Diagrams';
  toggle.onclick = togglePanel;
  document.body.appendChild(toggle);
}

// ===================== Panel Logic =====================

function togglePanel() {
  const panel = document.getElementById('aviflow-panel');
  panelVisible = !panelVisible;
  panel.classList.toggle('visible', panelVisible);
  if (panelVisible) {
    switchView('list');
    refreshList();
  }
}

function switchView(view) {
  panelView = view;
  document.getElementById('af-tab-list').classList.toggle('active', view === 'list');
  document.getElementById('af-tab-versions').classList.toggle('active', view === 'versions');
  if (view === 'list') refreshList();
  else if (view === 'versions') refreshVersions();
}

function showStatus(msg, type) {
  const el = document.getElementById('af-status');
  el.textContent = msg;
  el.className = `af-status ${type || ''}`;
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => { el.textContent = ''; el.className = 'af-status'; }, 3000);
}

function updateCurrentBar() {
  const bar = document.getElementById('af-current-bar');
  const name = document.getElementById('af-current-name');
  if (currentDiagramId && currentDiagramTitle) {
    bar.style.display = 'flex';
    name.textContent = currentDiagramTitle;
  } else {
    bar.style.display = 'none';
  }
}

function handleFilterChange() {
  projectFilter = document.getElementById('af-filter-project').value.trim();
  refreshList();
}

// ===================== List View =====================

async function refreshList() {
  const body = document.getElementById('af-body');
  body.innerHTML = '<div class="af-empty">Loading...</div>';
  try {
    const diagrams = await listDiagrams(projectFilter || null);
    if (!diagrams.length) {
      body.innerHTML = '<div class="af-empty">No diagrams yet.<br>Draw something and hit 💾 Save!</div>';
      return;
    }
    body.innerHTML = diagrams.map(d => `
      <div class="af-item ${d.id === currentDiagramId ? 'active' : ''}" onclick="handleLoad('${d.id}')">
        <div class="af-item-title">
          <span>${esc(d.title)}</span>
          <span style="font-size:10px;color:#6b7280;">v${d.version_count || 0}</span>
        </div>
        <div class="af-item-meta">
          ${d.project_key ? `📁 ${esc(d.project_key)}` : ''}
          ${d.created_by ? ` · 👤 ${esc(d.created_by)}` : ''}
          · ${fmtDate(d.updated_at)}
          ${d.tags && d.tags.length ? ` · ${d.tags.map(t => `<span style="background:#374151;padding:1px 5px;border-radius:3px;font-size:10px;">${esc(t)}</span>`).join(' ')}` : ''}
        </div>
        <div class="af-item-actions">
          <button class="af-btn af-btn-sm af-btn-secondary" onclick="event.stopPropagation(); handleRenameById('${d.id}', '${esc(d.title)}')">✏️ Rename</button>
          <button class="af-btn af-btn-sm af-btn-secondary" onclick="event.stopPropagation(); handleDuplicate('${d.id}')">📑 Duplicate</button>
          <button class="af-btn af-btn-sm af-btn-danger" onclick="event.stopPropagation(); handleDelete('${d.id}')">🗑</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = `<div class="af-empty" style="color:#ef4444;">Error: ${e.message}</div>`;
  }
}

// ===================== Version History View =====================

async function refreshVersions() {
  const body = document.getElementById('af-body');
  if (!currentDiagramId) {
    body.innerHTML = '<div class="af-empty">Load a diagram first to see its version history.</div>';
    return;
  }
  body.innerHTML = '<div class="af-empty">Loading history...</div>';
  try {
    const versions = await listVersions(currentDiagramId);
    if (!versions.length) {
      body.innerHTML = '<div class="af-empty">No version history yet.<br>Versions are created on each save.</div>';
      return;
    }
    body.innerHTML = versions.map((v, i) => `
      <div class="af-version-item" onclick="handleRestoreVersion('${v.id}', '${v.diagram_id}')">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;">v${versions.length - i}</span>
          <span class="af-version-meta">${v.saved_by || '?'} · ${fmtDate(v.created_at)}</span>
        </div>
        <div class="af-version-preview">${esc((v.content || '').substring(0, 200))}</div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = `<div class="af-empty" style="color:#ef4444;">Error: ${e.message}</div>`;
  }
}

// ===================== Handlers =====================

async function handleLoad(id) {
  const diagram = await loadDiagram(id);
  if (!diagram) { showStatus('Diagram not found', 'error'); return; }
  
  currentDiagramId = diagram.id;
  currentDiagramTitle = diagram.title;
  lastSavedContent = diagram.content;
  
  document.getElementById('af-save-title').value = diagram.title;
  document.getElementById('af-save-project').value = diagram.project_key || '';
  
  setCanvasContent(diagram.content);
  updateCurrentBar();
  showStatus(`Loaded "${diagram.title}"`, 'success');
  
  // Reload to render
  window.location.reload();
}

async function handleSave() {
  const title = document.getElementById('af-save-title').value.trim() || 'Untitled';
  const projectKey = document.getElementById('af-save-project').value.trim() || null;
  const content = getCurrentDrawingText();
  
  if (!content) { showStatus('Nothing to save — draw something first!', 'error'); return; }
  
  const result = await saveDiagram(currentDiagramId, title, content, projectKey, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
    currentDiagramTitle = result[0].title;
    lastSavedContent = content;
  }
  updateCurrentBar();
  refreshList();
  showStatus(currentDiagramId ? `Saved "${title}" (new version)` : `Created "${title}"`, 'success');
}

async function handleSaveNew() {
  const title = document.getElementById('af-save-title').value.trim() || 'Untitled';
  const projectKey = document.getElementById('af-save-project').value.trim() || null;
  const content = getCurrentDrawingText();
  
  if (!content) { showStatus('Nothing to save — draw something first!', 'error'); return; }
  
  const result = await saveDiagram(null, title, content, projectKey, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
    currentDiagramTitle = result[0].title;
    lastSavedContent = content;
  }
  updateCurrentBar();
  refreshList();
  showStatus(`Created "${title}"`, 'success');
}

function handleRename() {
  if (!currentDiagramId) return;
  const newTitle = prompt('Rename diagram:', currentDiagramTitle || '');
  if (newTitle && newTitle !== currentDiagramTitle) {
    renameDiagram(currentDiagramId, newTitle).then(() => {
      currentDiagramTitle = newTitle;
      document.getElementById('af-save-title').value = newTitle;
      updateCurrentBar();
      refreshList();
      showStatus(`Renamed to "${newTitle}"`, 'success');
    });
  }
}

function handleRenameById(id, currentTitle) {
  const newTitle = prompt('Rename diagram:', currentTitle || '');
  if (newTitle && newTitle !== currentTitle) {
    renameDiagram(id, newTitle).then(() => {
      if (id === currentDiagramId) {
        currentDiagramTitle = newTitle;
        document.getElementById('af-save-title').value = newTitle;
        updateCurrentBar();
      }
      refreshList();
      showStatus(`Renamed to "${newTitle}"`, 'success');
    });
  }
}

async function handleDuplicate(id) {
  const diagram = await loadDiagram(id);
  if (!diagram) return;
  const result = await saveDiagram(null, `${diagram.title} (copy)`, diagram.content, diagram.project_key, 'dashboard', diagram.tags);
  refreshList();
  showStatus(`Duplicated "${diagram.title}"`, 'success');
}

async function handleDelete(id) {
  if (!confirm('Delete this diagram and all its versions?')) return;
  await deleteDiagram(id);
  if (currentDiagramId === id) {
    currentDiagramId = null;
    currentDiagramTitle = null;
    updateCurrentBar();
  }
  refreshList();
  showStatus('Deleted', 'success');
}

async function handleRestoreVersion(versionId, diagramId) {
  if (!confirm('Restore this version? Current drawing will be replaced.')) return;
  const res = await fetch(`${API}/diagram_versions?id=eq.${versionId}`, { headers: HEADERS });
  const versions = await res.json();
  if (!versions[0]) { showStatus('Version not found', 'error'); return; }
  
  setCanvasContent(versions[0].content);
  showStatus('Restored — reload to see changes', 'success');
  window.location.reload();
}

function handleExportMarkdown() {
  const content = getCurrentDrawingText();
  if (!content) { showStatus('Nothing to copy', 'error'); return; }
  
  // Parse the localStorage JSON format to extract readable ASCII
  let ascii = '';
  try {
    const parsed = JSON.parse(content);
    // Reconstruct from character map
    if (parsed && typeof parsed === 'object') {
      const chars = {};
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [key, val] of Object.entries(parsed)) {
        const match = key.match(/(-?\d+),(-?\d+)/);
        if (match) {
          const x = parseInt(match[1]), y = parseInt(match[2]);
          chars[key] = typeof val === 'string' ? val : val.char || val;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      const lines = [];
      for (let y = minY; y <= maxY; y++) {
        let line = '';
        for (let x = minX; x <= maxX; x++) {
          line += chars[`${x},${y}`] || ' ';
        }
        lines.push(line.trimEnd());
      }
      // Remove trailing empty lines
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      ascii = lines.join('\n');
    }
  } catch {
    ascii = content;
  }
  
  const title = currentDiagramTitle || 'Untitled';
  const md = '```\n' + ascii + '\n```';
  
  navigator.clipboard.writeText(md).then(() => {
    showStatus('Copied as markdown!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = md;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showStatus('Copied as markdown!', 'success');
  });
}

// ===================== Auto-save =====================

setInterval(() => {
  if (!autoSaveEnabled || !currentDiagramId) return;
  const content = getCurrentDrawingText();
  if (content && content !== lastSavedContent) {
    const title = document.getElementById('af-save-title')?.value || currentDiagramTitle || 'Untitled';
    const projectKey = document.getElementById('af-save-project')?.value || null;
    saveDiagram(currentDiagramId, title, content, projectKey, 'dashboard').then(() => {
      lastSavedContent = content;
      showStatus('Auto-saved', 'success');
    }).catch(() => {});
  }
}, 30000);

// ===================== Helpers =====================

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ===================== Init =====================

window.addEventListener('DOMContentLoaded', () => {
  createPanel();
  updateCurrentBar();
});

// Expose for onclick handlers
window.togglePanel = togglePanel;
window.switchView = switchView;
window.handleLoad = handleLoad;
window.handleSave = handleSave;
window.handleSaveNew = handleSaveNew;
window.handleRename = handleRename;
window.handleRenameById = handleRenameById;
window.handleDuplicate = handleDuplicate;
window.handleDelete = handleDelete;
window.handleRestoreVersion = handleRestoreVersion;
window.handleExportMarkdown = handleExportMarkdown;
window.handleFilterChange = handleFilterChange;
