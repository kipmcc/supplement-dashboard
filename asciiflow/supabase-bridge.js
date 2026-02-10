/**
 * AviFlow — Supabase Bridge v2
 * Injects cloud diagram management directly into the ASCIIFlow left sidebar.
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

// ===================== API =====================

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
    await saveVersion(id, content, createdBy || 'dashboard');
    const vCount = await getVersionCount(id);
    const res = await fetch(`${API}/diagrams?id=eq.${id}`, {
      method: 'PATCH', headers: HEADERS,
      body: JSON.stringify({ title, content, project_key: projectKey || null,
        updated_at: new Date().toISOString(), version_count: vCount + 1, ...(tags ? { tags } : {}) })
    });
    return res.json();
  } else {
    const res = await fetch(`${API}/diagrams`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ title, content, project_key: projectKey || null,
        created_by: createdBy || 'dashboard', tags: tags || [], version_count: 1 })
    });
    return res.json();
  }
}

async function renameDiagram(id, newTitle) {
  return fetch(`${API}/diagrams?id=eq.${id}`, {
    method: 'PATCH', headers: HEADERS,
    body: JSON.stringify({ title: newTitle, updated_at: new Date().toISOString() })
  }).then(r => r.json());
}

async function deleteDiagram(id) {
  await fetch(`${API}/diagram_versions?diagram_id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
  await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
}

async function saveVersion(diagramId, content, savedBy) {
  await fetch(`${API}/diagram_versions`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ diagram_id: diagramId, content, saved_by: savedBy || 'dashboard' })
  });
}

async function getVersionCount(diagramId) {
  const res = await fetch(`${API}/diagram_versions?diagram_id=eq.${diagramId}&select=id`, { headers: HEADERS });
  return (await res.json()).length;
}

async function listVersions(diagramId) {
  const res = await fetch(`${API}/diagram_versions?diagram_id=eq.${diagramId}&order=created_at.desc&limit=30`, { headers: HEADERS });
  return res.json();
}

// ===================== Canvas =====================

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

// ===================== State =====================

let currentDiagramId = null;
let currentDiagramTitle = null;
let lastSavedContent = '';
let sidebarSection = null;

// ===================== Sidebar Injection =====================

function injectIntoSidebar() {
  // Find the ASCIIFlow drawer/sidebar — it's the left panel
  // We poll until the drawer is rendered (React async)
  const interval = setInterval(() => {
    // Look for the drawer container — ASCIIFlow uses a div with the tool list
    const drawer = document.querySelector('[class*="drawer"]') 
      || document.querySelector('[class*="Drawer"]');
    
    // Fallback: find by structure — the sidebar contains "File", "Edit" sections
    let sidebar = drawer;
    if (!sidebar) {
      // Find element containing "File" text that's in a sidebar-like container
      const allElements = document.querySelectorAll('div');
      for (const el of allElements) {
        if (el.offsetWidth > 200 && el.offsetWidth < 500 && el.offsetHeight > 400) {
          const text = el.textContent || '';
          if (text.includes('File') && text.includes('Edit') && text.includes('Boxes')) {
            sidebar = el;
            break;
          }
        }
      }
    }

    if (sidebar) {
      clearInterval(interval);
      // Try to collapse the Help section to make room
      const helpHeaders = sidebar.querySelectorAll('div, span, p');
      for (const el of helpHeaders) {
        if (el.textContent.trim() === 'Help' && el.offsetWidth > 50) {
          // Click to collapse if it has an expand/collapse toggle
          const chevron = el.parentElement?.querySelector('[class*="chevron"], [class*="expand"], svg');
          if (chevron) { try { chevron.click(); } catch {} }
          break;
        }
      }
      createSidebarSection(sidebar);
    }
  }, 500);

  // Stop trying after 10 seconds
  setTimeout(() => clearInterval(interval), 10000);
}

function createSidebarSection(sidebar) {
  if (sidebarSection) return; // Already injected

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
      #aviflow-cloud .af-section-title {
        font-weight: 700;
        font-size: 14px;
        margin-bottom: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: #1f2937;
      }
      #aviflow-cloud .af-refresh {
        background: none;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        padding: 2px 8px;
        color: #6b7280;
      }
      #aviflow-cloud .af-refresh:hover { background: #f3f4f6; }
      #aviflow-cloud .af-diagram-item {
        padding: 8px 10px;
        margin-bottom: 4px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
      }
      #aviflow-cloud .af-diagram-item:hover {
        border-color: #3b82f6;
        background: #eff6ff;
      }
      #aviflow-cloud .af-diagram-item.active {
        border-color: #3b82f6;
        background: #dbeafe;
      }
      #aviflow-cloud .af-diagram-name {
        font-weight: 600;
        font-size: 13px;
        color: #1f2937;
        display: flex;
        justify-content: space-between;
      }
      #aviflow-cloud .af-diagram-meta {
        font-size: 11px;
        color: #9ca3af;
        margin-top: 2px;
      }
      #aviflow-cloud .af-diagram-actions {
        margin-top: 4px;
        display: flex;
        gap: 4px;
      }
      #aviflow-cloud .af-btn {
        padding: 2px 8px;
        border-radius: 3px;
        border: 1px solid #d1d5db;
        background: #fff;
        cursor: pointer;
        font-size: 10px;
        color: #374151;
      }
      #aviflow-cloud .af-btn:hover { background: #f3f4f6; }
      #aviflow-cloud .af-btn-blue { background: #3b82f6; color: #fff; border-color: #3b82f6; }
      #aviflow-cloud .af-btn-blue:hover { background: #2563eb; }
      #aviflow-cloud .af-btn-red { color: #dc2626; border-color: #fca5a5; }
      #aviflow-cloud .af-btn-red:hover { background: #fef2f2; }
      #aviflow-cloud .af-save-area {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #e5e7eb;
      }
      #aviflow-cloud .af-save-area input {
        width: 100%;
        padding: 5px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        margin-bottom: 6px;
        box-sizing: border-box;
        color: #1f2937;
      }
      #aviflow-cloud .af-save-buttons {
        display: flex;
        gap: 4px;
      }
      #aviflow-cloud .af-save-buttons .af-btn { flex: 1; padding: 5px; font-size: 11px; text-align: center; }
      #aviflow-cloud .af-status-msg {
        font-size: 11px;
        padding: 4px 0;
        text-align: center;
        min-height: 18px;
      }
      #aviflow-cloud .af-status-msg.ok { color: #059669; }
      #aviflow-cloud .af-status-msg.err { color: #dc2626; }
      #aviflow-cloud .af-empty { color: #9ca3af; text-align: center; padding: 12px; font-size: 12px; }
      #aviflow-cloud .af-filter {
        margin-bottom: 8px;
      }
      #aviflow-cloud .af-filter input {
        width: 100%;
        padding: 4px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 11px;
        box-sizing: border-box;
        color: #6b7280;
      }
      #aviflow-cloud .af-versions-area {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #e5e7eb;
      }
      #aviflow-cloud .af-version-item {
        padding: 4px 8px;
        margin-bottom: 3px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
      }
      #aviflow-cloud .af-version-item:hover { border-color: #3b82f6; background: #eff6ff; }
    </style>

    <div class="af-section-title">
      ☁️ Cloud Diagrams
      <button class="af-refresh" onclick="window._af.refresh()">↻</button>
    </div>
    <div class="af-filter">
      <input type="text" id="af-filter" placeholder="Filter by project..." oninput="window._af.filter()" />
    </div>
    <div id="af-list"><div class="af-empty">Loading...</div></div>
    <div id="af-versions-container"></div>
    <div id="af-status" class="af-status-msg"></div>
    <div class="af-save-area">
      <input type="text" id="af-title" placeholder="Diagram title..." />
      <input type="text" id="af-project" placeholder="Project (e.g. outpost)" />
      <div class="af-save-buttons">
        <button class="af-btn af-btn-blue" onclick="window._af.save()">💾 Save</button>
        <button class="af-btn" onclick="window._af.saveNew()">➕ New</button>
        <button class="af-btn" onclick="window._af.copyMd()">📋 Copy</button>
      </div>
    </div>
  `;

  // Insert inside the MUI list, between File entries and Edit
  let inserted = false;
  const muiList = sidebar.querySelector('ul.MuiList-root, ul[class*="MuiList"]');
  if (muiList) {
    const listItems = Array.from(muiList.children);
    for (let i = 0; i < listItems.length; i++) {
      if (listItems[i].textContent.trim().startsWith('Edit')) {
        // Wrap in LI for valid HTML
        const li = document.createElement('li');
        li.style.listStyle = 'none';
        li.appendChild(section);
        muiList.insertBefore(li, listItems[i]);
        inserted = true;
        break;
      }
    }
  }
  if (!inserted) sidebar.appendChild(section);
  sidebarSection = section;
  refreshCloudList();
}

// ===================== Cloud List =====================

async function refreshCloudList() {
  const listEl = document.getElementById('af-list');
  if (!listEl) return;
  const filter = (document.getElementById('af-filter')?.value || '').trim();

  try {
    const diagrams = await listDiagrams(filter || null);
    if (!diagrams.length) {
      listEl.innerHTML = '<div class="af-empty">No cloud diagrams yet.<br>Draw something and hit 💾 Save!</div>';
      return;
    }
    listEl.innerHTML = diagrams.map(d => `
      <div class="af-diagram-item ${d.id === currentDiagramId ? 'active' : ''}" onclick="window._af.load('${d.id}')">
        <div class="af-diagram-name">
          <span>${esc(d.title)}</span>
          <span style="font-size:10px;color:#9ca3af;">v${d.version_count || 0}</span>
        </div>
        <div class="af-diagram-meta">
          ${d.project_key ? `📁 ${esc(d.project_key)}` : ''}
          ${d.created_by ? ` · ${esc(d.created_by)}` : ''}
          · ${fmtDate(d.updated_at)}
        </div>
        <div class="af-diagram-actions">
          <button class="af-btn" onclick="event.stopPropagation(); window._af.rename('${d.id}', '${esc(d.title)}')">✏️ Rename</button>
          <button class="af-btn" onclick="event.stopPropagation(); window._af.duplicate('${d.id}')">📑 Copy</button>
          <button class="af-btn" onclick="event.stopPropagation(); window._af.versions('${d.id}')">📜</button>
          <button class="af-btn af-btn-red" onclick="event.stopPropagation(); window._af.del('${d.id}')">🗑</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="af-empty" style="color:#dc2626;">Error: ${e.message}</div>`;
  }
}

// ===================== Handlers =====================

async function handleLoad(id) {
  const diagram = await loadDiagram(id);
  if (!diagram) { showMsg('Not found', 'err'); return; }
  currentDiagramId = diagram.id;
  currentDiagramTitle = diagram.title;
  lastSavedContent = diagram.content;
  document.getElementById('af-title').value = diagram.title;
  document.getElementById('af-project').value = diagram.project_key || '';
  setCanvasContent(diagram.content);
  showMsg(`Loaded "${diagram.title}" — reloading...`, 'ok');
  setTimeout(() => window.location.reload(), 300);
}

async function handleSave() {
  const title = document.getElementById('af-title').value.trim() || 'Untitled';
  const project = document.getElementById('af-project').value.trim() || null;
  const content = getCurrentDrawingText();
  if (!content) { showMsg('Nothing to save — draw first!', 'err'); return; }
  const result = await saveDiagram(currentDiagramId, title, content, project, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
    currentDiagramTitle = result[0].title;
    lastSavedContent = content;
  }
  showMsg(`Saved "${title}"`, 'ok');
  refreshCloudList();
}

async function handleSaveNew() {
  const title = document.getElementById('af-title').value.trim() || 'Untitled';
  const project = document.getElementById('af-project').value.trim() || null;
  const content = getCurrentDrawingText();
  if (!content) { showMsg('Nothing to save — draw first!', 'err'); return; }
  currentDiagramId = null;
  const result = await saveDiagram(null, title, content, project, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
    currentDiagramTitle = result[0].title;
    lastSavedContent = content;
  }
  showMsg(`Created "${title}"`, 'ok');
  refreshCloudList();
}

function handleRename(id, currentTitle) {
  const newTitle = prompt('Rename diagram:', currentTitle || '');
  if (!newTitle || newTitle === currentTitle) return;
  renameDiagram(id, newTitle).then(() => {
    if (id === currentDiagramId) {
      currentDiagramTitle = newTitle;
      document.getElementById('af-title').value = newTitle;
    }
    showMsg(`Renamed to "${newTitle}"`, 'ok');
    refreshCloudList();
  });
}

async function handleDuplicate(id) {
  const d = await loadDiagram(id);
  if (!d) return;
  await saveDiagram(null, `${d.title} (copy)`, d.content, d.project_key, 'dashboard', d.tags);
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

async function handleVersions(id) {
  const container = document.getElementById('af-versions-container');
  if (!container) return;
  const versions = await listVersions(id);
  if (!versions.length) {
    container.innerHTML = '<div class="af-versions-area"><div class="af-empty">No versions yet</div></div>';
    return;
  }
  container.innerHTML = `
    <div class="af-versions-area">
      <div style="font-weight:600;font-size:12px;margin-bottom:6px;">📜 Version History
        <button class="af-btn" onclick="document.getElementById('af-versions-container').innerHTML=''" style="float:right;">✕</button>
      </div>
      ${versions.map((v, i) => `
        <div class="af-version-item" onclick="window._af.restore('${v.id}')">
          <strong>v${versions.length - i}</strong> · ${v.saved_by || '?'} · ${fmtDate(v.created_at)}
        </div>
      `).join('')}
    </div>
  `;
}

async function handleRestore(versionId) {
  if (!confirm('Restore this version? Current canvas will be replaced.')) return;
  const res = await fetch(`${API}/diagram_versions?id=eq.${versionId}`, { headers: HEADERS });
  const versions = await res.json();
  if (!versions[0]) { showMsg('Version not found', 'err'); return; }
  setCanvasContent(versions[0].content);
  showMsg('Restored — reloading...', 'ok');
  setTimeout(() => window.location.reload(), 300);
}

function handleCopyMd() {
  const content = getCurrentDrawingText();
  if (!content) { showMsg('Nothing to copy', 'err'); return; }
  let ascii = content;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      const chars = {};
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [key, val] of Object.entries(parsed)) {
        const m = key.match(/(-?\d+),(-?\d+)/);
        if (m) {
          const x = parseInt(m[1]), y = parseInt(m[2]);
          chars[key] = typeof val === 'string' ? val : val.char || val;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      const lines = [];
      for (let y = minY; y <= maxY; y++) {
        let line = '';
        for (let x = minX; x <= maxX; x++) line += chars[`${x},${y}`] || ' ';
        lines.push(line.trimEnd());
      }
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      ascii = lines.join('\n');
    }
  } catch {}
  navigator.clipboard.writeText('```\n' + ascii + '\n```').then(
    () => showMsg('Copied as markdown!', 'ok'),
    () => showMsg('Copy failed', 'err')
  );
}

// ===================== Helpers =====================

function showMsg(text, type) {
  const el = document.getElementById('af-status');
  if (el) { el.textContent = text; el.className = `af-status-msg ${type || ''}`; }
  setTimeout(() => { if (el) { el.textContent = ''; el.className = 'af-status-msg'; } }, 3000);
}

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

// ===================== Auto-save =====================

setInterval(() => {
  if (!currentDiagramId) return;
  const content = getCurrentDrawingText();
  if (content && content !== lastSavedContent) {
    const title = document.getElementById('af-title')?.value || currentDiagramTitle || 'Untitled';
    const project = document.getElementById('af-project')?.value || null;
    saveDiagram(currentDiagramId, title, content, project, 'dashboard').then(() => {
      lastSavedContent = content;
      showMsg('Auto-saved', 'ok');
    }).catch(() => {});
  }
}, 30000);

// ===================== Init =====================

// Expose API for onclick handlers
window._af = {
  refresh: refreshCloudList,
  filter: () => refreshCloudList(),
  load: handleLoad,
  save: handleSave,
  saveNew: handleSaveNew,
  rename: handleRename,
  duplicate: handleDuplicate,
  del: handleDelete,
  versions: handleVersions,
  restore: handleRestore,
  copyMd: handleCopyMd,
};

window.addEventListener('DOMContentLoaded', () => {
  // Remove the old toggle button if it exists
  const oldToggle = document.getElementById('aviflow-toggle') || document.getElementById('supabase-toggle');
  if (oldToggle) oldToggle.remove();
  const oldPanel = document.getElementById('aviflow-panel') || document.getElementById('supabase-panel');
  if (oldPanel) oldPanel.remove();

  // Inject into sidebar
  injectIntoSidebar();
});
