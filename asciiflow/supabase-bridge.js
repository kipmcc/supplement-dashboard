/**
 * Supabase Bridge for ASCIIFlow
 * Adds save/load/list functionality backed by Supabase diagrams table.
 * Injected into the ASCIIFlow iframe page.
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

// ---- API Functions ----

async function listDiagrams() {
  const res = await fetch(`${API}/diagrams?order=updated_at.desc&limit=50`, { headers: HEADERS });
  return res.json();
}

async function saveDiagram(id, title, content, projectKey, createdBy) {
  if (id) {
    // Update existing
    const res = await fetch(`${API}/diagrams?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify({ title, content, project_key: projectKey, updated_at: new Date().toISOString() })
    });
    return res.json();
  } else {
    // Insert new
    const res = await fetch(`${API}/diagrams`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ title, content, project_key: projectKey, created_by: createdBy })
    });
    return res.json();
  }
}

async function deleteDiagram(id) {
  await fetch(`${API}/diagrams?id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
}

async function loadDiagram(id) {
  const res = await fetch(`${API}/diagrams?id=eq.${id}`, { headers: HEADERS });
  const data = await res.json();
  return data[0] || null;
}

// ---- Extract ASCII text from current drawing ----

function getCurrentDrawingText() {
  // Get all localStorage keys that look like drawing data
  const keys = Object.keys(localStorage).filter(k => k.startsWith('drawing/'));
  const committedKey = keys.find(k => k.includes('committed-layer'));
  if (!committedKey) return '';
  const raw = localStorage.getItem(committedKey);
  if (!raw) return '';
  return raw;
}

function getCurrentDrawingName() {
  // Try to get from URL hash
  const hash = window.location.hash;
  const match = hash.match(/\/local\/([^/]+)/);
  if (match) return decodeURIComponent(match[1]);
  return 'default';
}

// ---- UI ----

let currentDiagramId = null;
let panelVisible = false;

function createPanel() {
  const panel = document.createElement('div');
  panel.id = 'supabase-panel';
  panel.innerHTML = `
    <style>
      #supabase-panel {
        position: fixed;
        top: 48px;
        right: 0;
        width: 320px;
        height: calc(100vh - 48px);
        background: #1a1a2e;
        color: #e0e0e0;
        border-left: 2px solid #3b82f6;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        display: none;
        flex-direction: column;
        overflow: hidden;
      }
      #supabase-panel.visible { display: flex; }
      #supabase-panel .panel-header {
        padding: 12px 16px;
        background: #16213e;
        border-bottom: 1px solid #374151;
        font-weight: 600;
        font-size: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #supabase-panel .panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      #supabase-panel .diagram-item {
        padding: 10px 12px;
        margin-bottom: 6px;
        background: #16213e;
        border: 1px solid #374151;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
      }
      #supabase-panel .diagram-item:hover {
        border-color: #3b82f6;
        background: #1e293b;
      }
      #supabase-panel .diagram-item.active {
        border-color: #3b82f6;
        background: #1e3a5f;
      }
      #supabase-panel .diagram-title {
        font-weight: 600;
        margin-bottom: 4px;
      }
      #supabase-panel .diagram-meta {
        font-size: 11px;
        color: #9ca3af;
      }
      #supabase-panel .btn {
        padding: 6px 12px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: background 0.15s;
      }
      #supabase-panel .btn-primary { background: #3b82f6; color: white; }
      #supabase-panel .btn-primary:hover { background: #2563eb; }
      #supabase-panel .btn-secondary { background: #374151; color: #e0e0e0; }
      #supabase-panel .btn-secondary:hover { background: #4b5563; }
      #supabase-panel .btn-danger { background: #dc2626; color: white; }
      #supabase-panel .btn-danger:hover { background: #b91c1c; }
      #supabase-panel .actions { 
        padding: 12px; 
        border-top: 1px solid #374151; 
        display: flex; 
        gap: 8px; 
        flex-wrap: wrap;
      }
      #supabase-panel input, #supabase-panel select {
        width: 100%;
        padding: 6px 10px;
        background: #0f172a;
        border: 1px solid #374151;
        border-radius: 4px;
        color: #e0e0e0;
        font-size: 12px;
        margin-bottom: 8px;
      }
      #supabase-panel .save-form { padding: 12px; border-top: 1px solid #374151; }
      #supabase-toggle {
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
      #supabase-toggle:hover { background: #2563eb; }
    </style>
    <div class="panel-header">
      <span>☁️ Saved Diagrams</span>
      <button class="btn btn-secondary" onclick="togglePanel()" style="padding: 2px 8px;">✕</button>
    </div>
    <div class="panel-body" id="diagram-list">
      <div style="text-align: center; padding: 20px; color: #6b7280;">Loading...</div>
    </div>
    <div class="save-form">
      <input type="text" id="save-title" placeholder="Diagram title..." />
      <input type="text" id="save-project" placeholder="Project key (optional)" />
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-primary" onclick="handleSave()" style="flex:1;">💾 Save</button>
        <button class="btn btn-secondary" onclick="handleSaveNew()" style="flex:1;">➕ Save New</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Toggle button
  const toggle = document.createElement('button');
  toggle.id = 'supabase-toggle';
  toggle.textContent = '☁️ Diagrams';
  toggle.onclick = togglePanel;
  document.body.appendChild(toggle);
}

function togglePanel() {
  const panel = document.getElementById('supabase-panel');
  panelVisible = !panelVisible;
  panel.classList.toggle('visible', panelVisible);
  if (panelVisible) refreshList();
}

async function refreshList() {
  const listEl = document.getElementById('diagram-list');
  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280;">Loading...</div>';
  
  try {
    const diagrams = await listDiagrams();
    if (!diagrams.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280;">No saved diagrams yet.<br>Draw something and hit Save!</div>';
      return;
    }
    
    listEl.innerHTML = diagrams.map(d => `
      <div class="diagram-item ${d.id === currentDiagramId ? 'active' : ''}" onclick="handleLoad('${d.id}')">
        <div class="diagram-title">${escapeHtml(d.title)}</div>
        <div class="diagram-meta">
          ${d.project_key ? `📁 ${escapeHtml(d.project_key)} · ` : ''}
          ${d.created_by ? `👤 ${escapeHtml(d.created_by)} · ` : ''}
          ${formatDate(d.updated_at)}
        </div>
        <div style="margin-top:6px;">
          <button class="btn btn-danger" onclick="event.stopPropagation(); handleDelete('${d.id}')" style="padding:2px 8px;font-size:11px;">🗑</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Error: ${e.message}</div>`;
  }
}

async function handleLoad(id) {
  const diagram = await loadDiagram(id);
  if (!diagram) { alert('Diagram not found'); return; }
  
  currentDiagramId = diagram.id;
  document.getElementById('save-title').value = diagram.title;
  document.getElementById('save-project').value = diagram.project_key || '';
  
  // Load content into localStorage for the current drawing
  const drawingName = getCurrentDrawingName();
  const key = `drawing/${encodeURIComponent(`local/${encodeURIComponent(drawingName)}`)}/committed-layer`;
  localStorage.setItem(key, diagram.content);
  
  // Clear undo/redo
  const undoKey = `drawing/${encodeURIComponent(`local/${encodeURIComponent(drawingName)}`)}/undo-layers`;
  const redoKey = `drawing/${encodeURIComponent(`local/${encodeURIComponent(drawingName)}`)}/redo-layers`;
  localStorage.setItem(undoKey, '[]');
  localStorage.setItem(redoKey, '[]');
  
  // Reload to pick up changes
  window.location.reload();
}

async function handleSave() {
  const title = document.getElementById('save-title').value || 'Untitled';
  const projectKey = document.getElementById('save-project').value || null;
  const content = getCurrentDrawingText();
  
  if (!content) { alert('Nothing to save — draw something first!'); return; }
  
  const result = await saveDiagram(currentDiagramId, title, content, projectKey, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
  }
  refreshList();
}

async function handleSaveNew() {
  const title = document.getElementById('save-title').value || 'Untitled';
  const projectKey = document.getElementById('save-project').value || null;
  const content = getCurrentDrawingText();
  
  if (!content) { alert('Nothing to save — draw something first!'); return; }
  
  currentDiagramId = null; // Force new
  const result = await saveDiagram(null, title, content, projectKey, 'dashboard');
  if (Array.isArray(result) && result[0]) {
    currentDiagramId = result[0].id;
  }
  refreshList();
}

async function handleDelete(id) {
  if (!confirm('Delete this diagram?')) return;
  await deleteDiagram(id);
  if (currentDiagramId === id) currentDiagramId = null;
  refreshList();
}

// ---- Helpers ----

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + 
         d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ---- Auto-save (every 30 seconds if diagram has an ID) ----

setInterval(() => {
  if (currentDiagramId) {
    const title = document.getElementById('save-title')?.value || 'Untitled';
    const projectKey = document.getElementById('save-project')?.value || null;
    const content = getCurrentDrawingText();
    if (content) {
      saveDiagram(currentDiagramId, title, content, projectKey, 'dashboard').catch(() => {});
    }
  }
}, 30000);

// ---- Initialize ----

window.addEventListener('DOMContentLoaded', () => {
  createPanel();
});

// Make functions available globally for onclick handlers
window.togglePanel = togglePanel;
window.handleLoad = handleLoad;
window.handleSave = handleSave;
window.handleSaveNew = handleSaveNew;
window.handleDelete = handleDelete;
