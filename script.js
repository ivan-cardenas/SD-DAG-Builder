const canvas = document.getElementById('canvas');
const gridLayer = document.getElementById('grid-layer');
const objectsLayer = document.getElementById('objects-layer');
const edgesLayer = document.getElementById('edges-layer');
const nodesLayer = document.getElementById('nodes-layer');
const previewLayer = document.getElementById('preview-layer');

const DARK = window.matchMedia('(prefers-color-scheme: dark)').matches;

const COLORS = {
  object: { fill: DARK ? '#2a3020' : '#f0f4e8', stroke: DARK ? '#6a7a50' : '#8a9a6a', text: DARK ? '#a8b890' : '#4a5a3a' },
  stock: { fill: DARK ? '#0c2e50' : '#e6f1fb', stroke: '#378ADD', text: DARK ? '#85b7eb' : '#0c447c' },
  flow: { fill: DARK ? '#152a05' : '#eaf3de', stroke: '#639922', text: DARK ? '#97c459' : '#27500a' },
  aux: { fill: DARK ? '#3d1e10' : '#faece7', stroke: '#D85A30', text: DARK ? '#f0997b' : '#712b13' },
  const: { fill: DARK ? '#22195a' : '#eeedfe', stroke: '#7F77DD', text: DARK ? '#afa9ec' : '#3c3489' }
};

let tool = 'object';
let objects = [];
let nodes = [];
let edges = [];
let selectedId = null;
let selectedType = null; // 'object', 'node', 'edge'
let dragging = null;
let dragOffset = { x: 0, y: 0 };
let linkStart = null;
let idCounter = 0;
let modalTarget = null;
let modalKind = null;
let skipNextCanvasClick = false;

let lastClickTime = 0;
let lastClickId = null;

// Zoom & pan state
let viewBox = { x: 0, y: 0, w: 1400, h: 900 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
let currentZoom = 1;

function applyViewBox() {
  canvas.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function genId() { return 'e' + (++idCounter); }
function snapGrid(v, g = 20) { return Math.round(v / g) * g; }

const TOOL_HINTS = {
  select: 'Click to select • Double-click to edit • Drag to move',
  object: 'Click canvas to place object',
  stock: 'Click inside an object to place stock',
  const: 'Click inside an object to place constant',
  flow: 'Click source node, then click target node',
  aux: 'Click canvas to place auxiliary variable',
  link: 'Click source node, then click target node'
};

function setTool(t) {
  tool = t;
  linkStart = null;
  clearPreviewLine();
  document.querySelectorAll('#toolbar .tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-' + t);
  if (btn) btn.classList.add('active');
  canvas.style.cursor = { select: 'default', link: 'crosshair', flow: 'crosshair' }[t] || 'cell';
  document.getElementById('status-tool').textContent = 'Tool: ' + t.charAt(0).toUpperCase() + t.slice(1);
  document.getElementById('status-hint').textContent = TOOL_HINTS[t] || '';
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = viewBox.w / rect.width;
  const scaleY = viewBox.h / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX + viewBox.x,
    y: (e.clientY - rect.top) * scaleY + viewBox.y
  };
}

// Get all available variables for equation helper
function getAvailableVariables() {
  return nodes.map(n => ({ name: n.name, type: n.type, units: n.units }));
}

// Object functions
function createObject(x, y) {
  const id = genId();
  const obj = { id, name: 'Object_' + idCounter, x, y, w: 160, h: 100 };
  objects.push(obj);
  return obj;
}

function getObjectAt(x, y) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return o;
  }
  return null;
}

function getNodesInObject(objId) {
  return nodes.filter(n => n.objectId === objId);
}

function resizeObjectToFit(obj) {
  const children = getNodesInObject(obj.id);
  if (children.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  children.forEach(n => {
    const r = nodeRadius(n);
    const hw = r.hw || r.r || 30;
    const hh = r.hh || r.r || 20;
    minX = Math.min(minX, n.x - hw - 10);
    minY = Math.min(minY, n.y - hh - 25);
    maxX = Math.max(maxX, n.x + hw + 10);
    maxY = Math.max(maxY, n.y + hh + 10);
  });
  obj.x = Math.min(obj.x, minX);
  obj.y = Math.min(obj.y, minY);
  obj.w = Math.max(obj.w, maxX - obj.x);
  obj.h = Math.max(obj.h, maxY - obj.y);
}

// Node functions
function createNode(type, x, y, objectId = null) {
  const id = genId();
  const labels = { stock: 'Stock', flow: 'Flow', aux: 'Aux', const: 'Const' };
  const name = labels[type] + '_' + idCounter;
  const eq = (type === 'stock' || type === 'const') ? '0' : '';
  const n = { id, type, name, eq, units: '', x, y, objectId };
  nodes.push(n);
  return n;
}

function nodeRadius(n) {
  if (n.type === 'stock') return { hw: 44, hh: 20 };
  if (n.type === 'flow') return { hw: 28, hh: 16 };
  if (n.type === 'aux') return { r: 22 };
  return { r: 18 };
}

function getNodeAt(x, y) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const r = nodeRadius(n);
    if (r.hw) {
      if (Math.abs(x - n.x) <= r.hw && Math.abs(y - n.y) <= r.hh) return n;
    } else {
      if (Math.hypot(x - n.x, y - n.y) <= r.r) return n;
    }
  }
  return null;
}

// Edge functions
function createEdge(type, srcId, tgtId) {
  const id = genId();
  const edge = { id, type, src: srcId, tgt: tgtId, eq: '', units: '' };
  edges.push(edge);
  return edge;
}

function edgePoint(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const r = nodeRadius(from);
  let dist;
  if (r.hw) {
    const angle = Math.atan2(dy, dx);
    const ac = Math.abs(Math.cos(angle)), as = Math.abs(Math.sin(angle));
    dist = (ac * r.hh > as * r.hw) ? r.hw / ac : r.hh / as;
  } else {
    dist = r.r;
  }
  return { x: from.x + dx / len * dist, y: from.y + dy / len * dist };
}

// Rendering
function renderAll() {
  objectsLayer.innerHTML = '';
  edgesLayer.innerHTML = '';
  nodesLayer.innerHTML = '';
  objects.forEach(renderObject);
  edges.forEach(renderEdge);
  nodes.forEach(renderNode);
  updateTree();
  saveToStorage();
}

// Preview line for flow/link drafting
function clearPreviewLine() {
  previewLayer.innerHTML = '';
}

function drawPreviewLine(x1, y1, x2, y2) {
  previewLayer.innerHTML = '';
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', tool === 'flow' ? '#639922' : '#888');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-dasharray', '6 3');
  line.setAttribute('opacity', '0.6');
  line.setAttribute('pointer-events', 'none');
  previewLayer.appendChild(line);
}

// localStorage persistence
function saveToStorage() {
  try {
    localStorage.setItem('sd_model', JSON.stringify({ objects, nodes, edges, idCounter }));
  } catch(e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('sd_model');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.nodes?.length && !data.objects?.length) return false;
    objects = data.objects || [];
    nodes = data.nodes || [];
    edges = data.edges || [];
    idCounter = data.idCounter || 0;
    return true;
  } catch(e) { return false; }
}

function newModel() {
  if (!confirm('Start a new model? Unsaved changes will be lost.')) return;
  objects = []; nodes = []; edges = []; idCounter = 0;
  localStorage.removeItem('sd_model');
  renderAll();
  setTool('select');
}

function renderObject(obj) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', obj.id);
  
  const isSelected = selectedType === 'object' && selectedId === obj.id;
  
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', obj.x);
  rect.setAttribute('y', obj.y);
  rect.setAttribute('width', obj.w);
  rect.setAttribute('height', obj.h);
  rect.setAttribute('rx', 8);
  rect.setAttribute('fill', COLORS.object.fill);
  rect.setAttribute('stroke', isSelected ? '#378ADD' : COLORS.object.stroke);
  rect.setAttribute('stroke-width', isSelected ? 2 : 1);
  if (isSelected) rect.setAttribute('stroke-dasharray', '4 2');
  g.appendChild(rect);
  
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.textContent = obj.name;
  txt.setAttribute('x', obj.x + 8);
  txt.setAttribute('y', obj.y + 14);
  txt.setAttribute('fill', COLORS.object.text);
  txt.setAttribute('font-size', '10');
  txt.setAttribute('font-weight', '500');
  g.appendChild(txt);
  
  g.style.cursor = 'move';
  g.addEventListener('mousedown', e => onObjectMouseDown(e, obj));
  objectsLayer.appendChild(g);
}

function renderNode(n) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', n.id);
  const c = COLORS[n.type];
  const isSelected = selectedType === 'node' && selectedId === n.id;
  
  if (n.type === 'stock') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', n.x - 44);
    rect.setAttribute('y', n.y - 20);
    rect.setAttribute('width', 88);
    rect.setAttribute('height', 40);
    rect.setAttribute('rx', 4);
    rect.setAttribute('fill', c.fill);
    rect.setAttribute('stroke', isSelected ? '#fff' : c.stroke);
    rect.setAttribute('stroke-width', isSelected ? 2 : 1.5);
    g.appendChild(rect);
  } else if (n.type === 'flow') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', n.x - 28);
    rect.setAttribute('y', n.y - 16);
    rect.setAttribute('width', 56);
    rect.setAttribute('height', 32);
    rect.setAttribute('rx', 3);
    rect.setAttribute('fill', c.fill);
    rect.setAttribute('stroke', isSelected ? '#fff' : c.stroke);
    rect.setAttribute('stroke-width', 1.5);
    rect.setAttribute('stroke-dasharray', '4 2');
    g.appendChild(rect);
  } else if (n.type === 'aux') {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', 22);
    circle.setAttribute('fill', c.fill);
    circle.setAttribute('stroke', isSelected ? '#fff' : c.stroke);
    circle.setAttribute('stroke-width', 1.5);
    g.appendChild(circle);
  } else {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', 18);
    circle.setAttribute('fill', c.fill);
    circle.setAttribute('stroke', isSelected ? '#fff' : c.stroke);
    circle.setAttribute('stroke-width', 1);
    g.appendChild(circle);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', n.x - 12);
    line.setAttribute('y1', n.y + 14);
    line.setAttribute('x2', n.x + 12);
    line.setAttribute('y2', n.y + 14);
    line.setAttribute('stroke', c.stroke);
    g.appendChild(line);
  }
  
  const maxLen = n.type === 'const' ? 8 : n.type === 'flow' ? 7 : 10;
  const shortName = n.name.length > maxLen ? n.name.slice(0, maxLen - 1) + '…' : n.name;
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.textContent = shortName;
  txt.setAttribute('x', n.x);
  txt.setAttribute('y', n.y - (n.type === 'stock' ? 2 : n.type === 'flow' ? 0 : 2));
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('dominant-baseline', 'middle');
  txt.setAttribute('fill', c.text);
  txt.setAttribute('font-size', n.type === 'const' ? '9' : '10');
  txt.style.pointerEvents = 'none';
  g.appendChild(txt);
  
  if (n.eq && n.type !== 'aux') {
    const eqTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const shortEq = n.eq.length > 7 ? n.eq.slice(0, 6) + '…' : n.eq;
    eqTxt.textContent = shortEq;
    eqTxt.setAttribute('x', n.x);
    eqTxt.setAttribute('y', n.y + (n.type === 'stock' ? 10 : 10));
    eqTxt.setAttribute('text-anchor', 'middle');
    eqTxt.setAttribute('fill', c.text);
    eqTxt.setAttribute('font-size', '8');
    eqTxt.setAttribute('font-family', 'monospace');
    eqTxt.setAttribute('opacity', '0.7');
    eqTxt.style.pointerEvents = 'none';
    g.appendChild(eqTxt);
  }
  
  g.style.cursor = 'pointer';
  g.addEventListener('mousedown', e => onNodeMouseDown(e, n));
  nodesLayer.appendChild(g);
}

function renderEdge(e) {
  const src = nodes.find(n => n.id === e.src);
  const tgt = nodes.find(n => n.id === e.tgt);
  if (!src || !tgt) return;
  
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', e.id);
  g.style.cursor = 'pointer';
  
  const isSelected = selectedType === 'edge' && selectedId === e.id;
  const p1 = edgePoint(src, tgt);
  const p2 = edgePoint(tgt, src);
  
  if (e.type === 'flow') {
    // Hit area for easier clicking
    const hitarea = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hitarea.setAttribute('x1', p1.x);
    hitarea.setAttribute('y1', p1.y);
    hitarea.setAttribute('x2', p2.x);
    hitarea.setAttribute('y2', p2.y);
    hitarea.setAttribute('class', 'edge-hitarea');
    g.appendChild(hitarea);
    
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', isSelected ? '#378ADD' : '#639922');
    line.setAttribute('stroke-width', isSelected ? 3 : 2.5);
    line.setAttribute('marker-end', isSelected ? 'url(#arr-flow-sel)' : 'url(#arr-flow)');
    g.appendChild(line);
    
    // Show equation label on flow
    if (e.eq) {
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.textContent = e.eq.length > 12 ? e.eq.slice(0, 11) + '…' : e.eq;
      label.setAttribute('x', mx);
      label.setAttribute('y', my - 6);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', DARK ? '#97c459' : '#27500a');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'monospace');
      label.style.pointerEvents = 'none';
      g.appendChild(label);
    }
  } else {
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = mx - dy / len * 30, cy = my + dx / len * 30;
    
    // Hit area
    const hitpath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitpath.setAttribute('d', `M${p1.x},${p1.y} Q${cx},${cy} ${p2.x},${p2.y}`);
    hitpath.setAttribute('class', 'edge-hitarea');
    g.appendChild(hitpath);
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${p1.x},${p1.y} Q${cx},${cy} ${p2.x},${p2.y}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', isSelected ? '#378ADD' : (DARK ? '#9c9a92' : '#888'));
    path.setAttribute('stroke-width', isSelected ? 2 : 1);
    path.setAttribute('stroke-dasharray', '4 3');
    path.setAttribute('marker-end', isSelected ? 'url(#arr-link-sel)' : 'url(#arr-link)');
    g.appendChild(path);
  }
  
  g.addEventListener('mousedown', ev => {
    ev.stopPropagation();
    const now = Date.now();
    if (lastClickId === e.id && now - lastClickTime < 350) {
      openEdgeModal(e);
      lastClickTime = 0;
      lastClickId = null;
      return;
    }
    lastClickTime = now;
    lastClickId = e.id;
    selectEdge(e);
  });
  edgesLayer.appendChild(g);
}

function updateTree() {
  const tree = document.getElementById('objects-tree');
  tree.innerHTML = '';
  
  objects.forEach(obj => {
    const div = document.createElement('div');
    div.className = 'tree-object';
    
    const header = document.createElement('div');
    header.className = 'tree-object-header';
    header.innerHTML = `<svg width="10" height="10"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="${COLORS.object.stroke}" stroke-width="1.2"/></svg> ${obj.name}`;
    header.onclick = () => selectObject(obj);
    div.appendChild(header);
    
    const children = document.createElement('div');
    children.className = 'tree-children';
    getNodesInObject(obj.id).forEach(n => {
      const item = document.createElement('div');
      item.className = 'tree-item' + (selectedType === 'node' && selectedId === n.id ? ' selected' : '');
      item.innerHTML = `<span class="tree-item-dot" style="background:${COLORS[n.type].stroke}"></span> ${n.name}`;
      item.onclick = () => selectNode(n);
      children.appendChild(item);
    });
    div.appendChild(children);
    tree.appendChild(div);
  });
  
  // Standalone nodes
  const standalone = nodes.filter(n => !n.objectId);
  if (standalone.length > 0) {
    standalone.forEach(n => {
      const item = document.createElement('div');
      item.className = 'tree-standalone' + (selectedType === 'node' && selectedId === n.id ? ' selected' : '');
      item.innerHTML = `<span class="tree-item-dot" style="background:${COLORS[n.type].stroke}"></span> ${n.name}`;
      item.onclick = () => selectNode(n);
      tree.appendChild(item);
    });
  }
  
  // Edges section
  if (edges.length > 0) {
    const edgeSection = document.createElement('div');
    edgeSection.className = 'tree-standalone';
    edgeSection.style.background = 'var(--bg-tertiary)';
    edgeSection.style.cursor = 'default';
    edgeSection.innerHTML = `<strong style="font-size:9px;color:var(--text-secondary)">CONNECTIONS (${edges.length})</strong>`;
    tree.appendChild(edgeSection);
    
    edges.forEach(e => {
      const src = nodes.find(n => n.id === e.src);
      const tgt = nodes.find(n => n.id === e.tgt);
      const item = document.createElement('div');
      item.className = 'tree-standalone' + (selectedType === 'edge' && selectedId === e.id ? ' selected' : '');
      item.innerHTML = `<span style="color:${e.type === 'flow' ? '#639922' : '#888'}">${e.type === 'flow' ? '→' : '⤳'}</span> ${src?.name || '?'} → ${tgt?.name || '?'}`;
      item.onclick = () => selectEdge(e);
      tree.appendChild(item);
    });
  }
}

// Selection
function selectObject(obj) {
  selectedType = 'object';
  selectedId = obj.id;
  renderAll();
}

function selectNode(n) {
  selectedType = 'node';
  selectedId = n.id;
  renderAll();
}

function selectEdge(e) {
  selectedType = 'edge';
  selectedId = e.id;
  renderAll();
}

function deselectAll() {
  selectedType = null;
  selectedId = null;
  linkStart = null;
  clearPreviewLine();
  renderAll();
}

function deleteSelected() {
  if (!selectedId) return;
  if (selectedType === 'object') {
    const children = getNodesInObject(selectedId);
    children.forEach(n => {
      edges = edges.filter(e => e.src !== n.id && e.tgt !== n.id);
    });
    nodes = nodes.filter(n => n.objectId !== selectedId);
    objects = objects.filter(o => o.id !== selectedId);
  } else if (selectedType === 'node') {
    edges = edges.filter(e => e.src !== selectedId && e.tgt !== selectedId);
    nodes = nodes.filter(n => n.id !== selectedId);
  } else if (selectedType === 'edge') {
    edges = edges.filter(e => e.id !== selectedId);
  }
  deselectAll();
}

// Event handlers
function onObjectMouseDown(e, obj) {
  e.stopPropagation();
  
  // Handle double-click manually
  const now = Date.now();
  if (lastClickId === obj.id && now - lastClickTime < 350) {
    openObjectModal(obj);
    lastClickTime = 0;
    lastClickId = null;
    return;
  }
  lastClickTime = now;
  lastClickId = obj.id;
  
  if (tool === 'select') {
    selectObject(obj);
    dragging = { type: 'object', obj };
    const pos = getCanvasPos(e);
    dragOffset = { x: pos.x - obj.x, y: pos.y - obj.y };
  }
}

function onNodeMouseDown(e, n) {
  e.stopPropagation();
  
  // Handle double-click manually
  const now = Date.now();
  if (lastClickId === n.id && now - lastClickTime < 350) {
    openNodeModal(n);
    lastClickTime = 0;
    lastClickId = null;
    return;
  }
  lastClickTime = now;
  lastClickId = n.id;
  
  if (tool === 'link' || tool === 'flow') {
    if (!linkStart) {
      linkStart = n;
      document.getElementById('status-hint').textContent = `Source: "${n.name}" — now click target node  (Esc to cancel)`;
    } else if (linkStart.id !== n.id) {
      const exists = edges.some(ed => ed.src === linkStart.id && ed.tgt === n.id);
      if (!exists) {
        const type = tool === 'flow' ? 'flow' : 'link';
        const edge = createEdge(type, linkStart.id, n.id);
        clearPreviewLine();
        renderAll();
        document.getElementById('status-hint').textContent = TOOL_HINTS[tool] || '';
        // Open modal for the new edge (especially for flows)
        if (type === 'flow') {
          skipNextCanvasClick = true;
          setTimeout(() => openEdgeModal(edge), 50);
        }
      }
      linkStart = null;
      clearPreviewLine();
    }
    return;
  }
  if (tool === 'select') {
    selectNode(n);
    dragging = { type: 'node', node: n };
    const pos = getCanvasPos(e);
    dragOffset = { x: pos.x - n.x, y: pos.y - n.y };
  }
}

canvas.addEventListener('click', e => {
  if (skipNextCanvasClick) {
    skipNextCanvasClick = false;
    return;
  }
  if (e.ctrlKey) return; // Ctrl+click is pan, not place
  
  if (tool === 'select' || tool === 'link' || tool === 'flow') {
    if (e.target === canvas || e.target.closest('#grid-layer')) {
      deselectAll();
      linkStart = null;
    }
    return;
  }
  
  const pos = getCanvasPos(e);
  const sx = snapGrid(pos.x), sy = snapGrid(pos.y);
  
  if (tool === 'object') {
    const obj = createObject(sx - 80, sy - 50);
    renderAll();
    selectObject(obj);
    openObjectModal(obj);
  } else if (tool === 'stock' || tool === 'const') {
    const obj = getObjectAt(sx, sy);
    const n = createNode(tool, sx, sy, obj?.id);
    if (obj) resizeObjectToFit(obj);
    renderAll();
    selectNode(n);
    openNodeModal(n);
  } else if (tool === 'aux') {
    const n = createNode('aux', sx, sy, null);
    renderAll();
    selectNode(n);
    openNodeModal(n);
  }
});

canvas.addEventListener('mousemove', e => {
  if (linkStart && (tool === 'flow' || tool === 'link')) {
    const pos = getCanvasPos(e);
    drawPreviewLine(linkStart.x, linkStart.y, pos.x, pos.y);
  }
});

window.addEventListener('mousemove', e => {
  if (!dragging) return;

  const pos = getCanvasPos(e);
  if (dragging.type === 'object') {
    const obj = dragging.obj;
    const newX = pos.x - dragOffset.x;
    const newY = pos.y - dragOffset.y;
    const dx = newX - obj.x, dy = newY - obj.y;
    obj.x = newX;
    obj.y = newY;
    getNodesInObject(obj.id).forEach(n => { n.x += dx; n.y += dy; });
  } else if (dragging.type === 'node') {
    const n = dragging.node;
    n.x = pos.x - dragOffset.x;
    n.y = pos.y - dragOffset.y;
    const obj = getObjectAt(n.x, n.y);
    if ((n.type === 'stock' || n.type === 'const') && obj) {
      n.objectId = obj.id;
      resizeObjectToFit(obj);
    } else if (n.type === 'stock' || n.type === 'const') {
      n.objectId = null;
    }
  }
  renderAll();
});

window.addEventListener('mouseup', () => {
  dragging = null;
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = { select: 'default', link: 'crosshair', flow: 'crosshair' }[tool] || 'cell';
  }
});

// Zoom with mouse wheel
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  // Mouse position in SVG coords before zoom
  const mx = (e.clientX - rect.left) / rect.width * viewBox.w + viewBox.x;
  const my = (e.clientY - rect.top) / rect.height * viewBox.h + viewBox.y;

  const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
  const newZoom = currentZoom / factor;
  if (newZoom < ZOOM_MIN || newZoom > ZOOM_MAX) return;
  currentZoom = newZoom;

  const newW = viewBox.w * factor;
  const newH = viewBox.h * factor;
  viewBox.x = mx - (mx - viewBox.x) * factor;
  viewBox.y = my - (my - viewBox.y) * factor;
  viewBox.w = newW;
  viewBox.h = newH;
  applyViewBox();
  drawGrid();
  updateZoomDisplay();
}, { passive: false });

// Pan with middle mouse button or Ctrl+left click
canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
    e.preventDefault();
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  }
});

window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  const rect = canvas.getBoundingClientRect();
  const dx = (e.clientX - panStart.x) / rect.width * viewBox.w;
  const dy = (e.clientY - panStart.y) / rect.height * viewBox.h;
  viewBox.x -= dx;
  viewBox.y -= dy;
  panStart = { x: e.clientX, y: e.clientY };
  applyViewBox();
  drawGrid();
});

function zoomIn() {
  zoomTo(currentZoom * 1.3);
}

function zoomOut() {
  zoomTo(currentZoom / 1.3);
}

function zoomFit() {
  if (nodes.length === 0 && objects.length === 0) {
    viewBox = { x: 0, y: 0, w: 1400, h: 900 };
    currentZoom = 1;
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    objects.forEach(o => {
      minX = Math.min(minX, o.x);
      minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + o.w);
      maxY = Math.max(maxY, o.y + o.h);
    });
    nodes.forEach(n => {
      minX = Math.min(minX, n.x - 30);
      minY = Math.min(minY, n.y - 30);
      maxX = Math.max(maxX, n.x + 30);
      maxY = Math.max(maxY, n.y + 30);
    });
    const padding = 80;
    minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    const rect = canvas.getBoundingClientRect();
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const scaleX = contentW / rect.width;
    const scaleY = contentH / rect.height;
    const scale = Math.max(scaleX, scaleY);
    viewBox.w = rect.width * scale;
    viewBox.h = rect.height * scale;
    viewBox.x = minX - (viewBox.w - contentW) / 2;
    viewBox.y = minY - (viewBox.h - contentH) / 2;
    currentZoom = rect.width / viewBox.w;
  }
  applyViewBox();
  drawGrid();
  updateZoomDisplay();
}

function zoomTo(newZoom) {
  newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
  const rect = canvas.getBoundingClientRect();
  // Zoom toward center of current view
  const cx = viewBox.x + viewBox.w / 2;
  const cy = viewBox.y + viewBox.h / 2;
  const newW = rect.width / newZoom;
  const newH = rect.height / newZoom;
  viewBox.x = cx - newW / 2;
  viewBox.y = cy - newH / 2;
  viewBox.w = newW;
  viewBox.h = newH;
  currentZoom = newZoom;
  applyViewBox();
  drawGrid();
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-level');
  if (el) el.textContent = Math.round(currentZoom * 100) + '%';
}

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if (e.key === 'Escape') { deselectAll(); linkStart = null; closeModal(); }
});

// Build variable chips HTML
function buildVariableChips(currentName = '') {
  const vars = getAvailableVariables().filter(v => v.name !== currentName);
  if (vars.length === 0) return '<div style="font-size:10px;color:var(--text-secondary)">No other variables defined yet</div>';
  
  return vars.map(v => 
    `<span class="var-chip ${v.type}" onclick="insertVariable('${v.name}')" title="${v.units || 'no units'}">${v.name}</span>`
  ).join('');
}

// Insert variable into equation field
function insertVariable(name) {
  const eqField = document.getElementById('m-eq');
  if (!eqField) return;
  const start = eqField.selectionStart;
  const end = eqField.selectionEnd;
  const text = eqField.value;
  eqField.value = text.slice(0, start) + name + text.slice(end);
  eqField.focus();
  eqField.setSelectionRange(start + name.length, start + name.length);
}

// Modals
function openObjectModal(obj) {
  modalTarget = obj;
  modalKind = 'object';
  document.getElementById('modal-title').textContent = 'Edit Object';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <label>Name (Django Model Name)</label>
      <input id="m-name" type="text" value="${obj.name}" placeholder="e.g. WaterReservoir">
      <div class="form-hint">Use PascalCase for Django model naming</div>
    </div>
  `;
  document.getElementById('modal-buttons').innerHTML = `
    <button onclick="closeModal()">Cancel</button>
    <button class="primary" onclick="saveModal()">Save</button>
  `;
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('m-name').focus(), 50);
}

function openNodeModal(n) {
  modalTarget = n;
  modalKind = 'node';
  const labels = { stock: 'Stock', flow: 'Flow', aux: 'Auxiliary', const: 'Constant' };
  const eqLabel = { stock: 'Initial Value', flow: 'Rate Equation', aux: 'Equation', const: 'Value' };
  const hints = {
    stock: 'Accumulated quantity. Set an initial numeric value.',
    flow: 'Rate of change. Reference other variables by name.',
    aux: 'Intermediate formula. Reference stocks, flows, or constants.',
    const: 'Fixed parameter. Enter a numeric value.'
  };
  
  const showVarHelper = n.type === 'flow' || n.type === 'aux';
  
  document.getElementById('modal-title').textContent = 'Edit ' + labels[n.type];
  document.getElementById('modal-body').innerHTML = `
    <div class="form-hint" style="margin-bottom:10px">${hints[n.type]}</div>
    <div class="form-row">
      <label>Name</label>
      <input id="m-name" type="text" value="${n.name}" placeholder="e.g. reservoir_volume">
    </div>
    <div class="form-row">
      <label>${eqLabel[n.type]}</label>
      <textarea id="m-eq" placeholder="${n.type === 'flow' || n.type === 'aux' ? 'e.g. inflow_rate * 0.8' : 'e.g. 1000'}">${n.eq || ''}</textarea>
      ${showVarHelper ? `
        <div class="form-hint">Click a variable to insert it:</div>
        <div class="var-chips">${buildVariableChips(n.name)}</div>
      ` : ''}
    </div>
    <div class="form-row">
      <label>Units</label>
      <input id="m-units" type="text" value="${n.units || ''}" placeholder="e.g. m3, m3/day">
      <div class="form-hint">Used for dimensional analysis validation</div>
    </div>
  `;
  document.getElementById('modal-buttons').innerHTML = `
    <button onclick="closeModal()">Cancel</button>
    <button class="primary" onclick="saveModal()">Save</button>
  `;
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('m-name').focus(), 50);
}

function openEdgeModal(e) {
  modalTarget = e;
  modalKind = 'edge';
  const src = nodes.find(n => n.id === e.src);
  const tgt = nodes.find(n => n.id === e.tgt);
  
  const isFlow = e.type === 'flow';
  const title = isFlow ? 'Edit Flow Connection' : 'Edit Link';
  
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = `
    <div class="form-hint" style="margin-bottom:10px">
      <strong>${src?.name || '?'}</strong> → <strong>${tgt?.name || '?'}</strong>
      ${isFlow ? '<br>Define the rate equation for this flow.' : '<br>This link indicates a causal dependency.'}
    </div>
    ${isFlow ? `
      <div class="form-row">
        <label>Flow Rate Equation</label>
        <textarea id="m-eq" placeholder="e.g. rainfall_rate * efficiency">${e.eq || ''}</textarea>
        <div class="form-hint">Click a variable to insert it:</div>
        <div class="var-chips">${buildVariableChips()}</div>
      </div>
      <div class="form-row">
        <label>Units</label>
        <input id="m-units" type="text" value="${e.units || ''}" placeholder="e.g. m3/day">
      </div>
    ` : `
      <div class="form-hint">Links don't have equations—they just show dependencies.</div>
    `}
  `;
  document.getElementById('modal-buttons').innerHTML = `
    <button class="danger" onclick="deleteEdgeFromModal()">Delete</button>
    <button onclick="closeModal()">Cancel</button>
    <button class="primary" onclick="saveModal()">Save</button>
  `;
  document.getElementById('modal-overlay').classList.add('open');
  if (isFlow) {
    setTimeout(() => document.getElementById('m-eq')?.focus(), 50);
  }
}

function deleteEdgeFromModal() {
  if (modalTarget && modalKind === 'edge') {
    edges = edges.filter(e => e.id !== modalTarget.id);
    closeModal();
    renderAll();
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  modalTarget = null;
  modalKind = null;
}

function saveModal() {
  if (!modalTarget) return;
  
  if (modalKind === 'object') {
    const name = document.getElementById('m-name').value.trim().replace(/\s+/g, '_');
    modalTarget.name = name || modalTarget.name;
  } else if (modalKind === 'node') {
    const name = document.getElementById('m-name').value.trim().replace(/\s+/g, '_');
    modalTarget.name = name || modalTarget.name;
    modalTarget.eq = document.getElementById('m-eq').value.trim();
    modalTarget.units = document.getElementById('m-units').value.trim();
  } else if (modalKind === 'edge') {
    const eqField = document.getElementById('m-eq');
    const unitsField = document.getElementById('m-units');
    if (eqField) modalTarget.eq = eqField.value.trim();
    if (unitsField) modalTarget.units = unitsField.value.trim();
  }
  
  closeModal();
  renderAll();
}

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// Unit Validation
function validateUnits() {
  const results = [];
  
  nodes.filter(n => n.type === 'stock').forEach(n => {
    if (!n.units) results.push({ type: 'warning', msg: `Stock "${n.name}" has no units` });
  });
  
  nodes.filter(n => n.type === 'flow').forEach(n => {
    if (!n.units) results.push({ type: 'warning', msg: `Flow "${n.name}" has no units` });
    else if (!n.units.includes('/')) results.push({ type: 'warning', msg: `Flow "${n.name}" should be rate units (e.g. m3/day)` });
  });
  
  edges.filter(e => e.type === 'flow').forEach(e => {
    const src = nodes.find(n => n.id === e.src);
    const tgt = nodes.find(n => n.id === e.tgt);
    if (src && tgt) {
      const flow = src.type === 'flow' ? src : tgt;
      const stock = src.type === 'stock' ? src : tgt;
      if (flow && stock && flow.units && stock.units) {
        const flowBase = flow.units.split('/')[0].trim();
        if (flowBase !== stock.units.trim()) {
          results.push({ type: 'error', msg: `Unit mismatch: "${flow.name}" (${flowBase}) ↔ "${stock.name}" (${stock.units})` });
        }
      }
    }
    // Also check edge equation
    if (!e.eq) results.push({ type: 'warning', msg: `Flow connection has no equation` });
  });
  
  const allNames = nodes.map(n => n.name);
  [...nodes.filter(n => n.eq && (n.type === 'flow' || n.type === 'aux')), ...edges.filter(e => e.eq)].forEach(item => {
    const refs = item.eq.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    refs.forEach(ref => {
      if (!allNames.includes(ref) && isNaN(parseFloat(ref))) {
        results.push({ type: 'error', msg: `"${item.name || 'Connection'}" references unknown "${ref}"` });
      }
    });
  });
  
  if (results.length === 0) results.push({ type: 'success', msg: 'All validations passed!' });
  
  document.getElementById('validation-list').innerHTML = results.map(r => `
    <div class="validation-item ${r.type}">
      <span class="validation-icon">${r.type === 'error' ? '✗' : r.type === 'warning' ? '⚠' : '✓'}</span>
      ${r.msg}
    </div>
  `).join('');
}

// Export Modal
function openExportModal() {
  modalKind = 'export';
  document.getElementById('modal-title').textContent = 'Export to Django';
  document.getElementById('modal-body').innerHTML = `
    <div class="export-tabs">
      <button class="export-tab active" onclick="showExportTab(this, 'models')">models.py</button>
      <button class="export-tab" onclick="showExportTab(this, 'views')">views.py</button>
      <button class="export-tab" onclick="showExportTab(this, 'urls')">urls.py</button>
    </div>
    <div id="export-content">${generateModels()}</div>
  `;
  document.getElementById('modal-buttons').innerHTML = `
    <button onclick="closeModal()">Close</button>
    <button class="primary" onclick="copyExport()">Copy</button>
    <button class="primary" onclick="downloadExport()">Download All</button>
  `;
  document.getElementById('modal-overlay').classList.add('open');
}

function showExportTab(btn, tab) {
  document.querySelectorAll('.export-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('export-content').textContent = { models: generateModels, views: generateViews, urls: generateUrls }[tab]();
}

function generateModels() {
  let code = `from django.contrib.gis.db import models

class SystemDynamicsBase(models.Model):
    """Base class for all system dynamics objects"""
    name = models.CharField(max_length=100)
    geometry = models.PointField(null=True, blank=True, srid=4326)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        abstract = True

`;

  objects.forEach(obj => {
    const children = getNodesInObject(obj.id);
    const stocks = children.filter(n => n.type === 'stock');
    const consts = children.filter(n => n.type === 'const');
    
    code += `class ${obj.name}(SystemDynamicsBase):
    """${obj.name} - System Dynamics Object"""
`;
    stocks.forEach(s => {
      code += `    ${s.name.toLowerCase()} = models.FloatField(default=${s.eq || 0}, help_text='Stock: ${s.units || 'units'}')\n`;
    });
    consts.forEach(c => {
      code += `    ${c.name.toLowerCase()} = models.FloatField(default=${c.eq || 0}, help_text='Constant: ${c.units || 'units'}')\n`;
    });
    code += `
    class Meta:
        verbose_name = '${obj.name}'

`;
  });

  return code;
}

function generateViews() {
  const objNames = objects.map(o => o.name);
  
  let code = `from django.http import JsonResponse
from django.views import View
from .models import ${objNames.length ? objNames.join(', ') : 'SystemDynamicsBase'}

def compute_flows(state, dt):
    """Compute flow rates. Flows defined on edges:"""
    derivatives = {}
    
`;

  edges.filter(e => e.type === 'flow' && e.eq).forEach(edge => {
    const src = nodes.find(n => n.id === edge.src);
    const tgt = nodes.find(n => n.id === edge.tgt);
    code += `    # ${src?.name} → ${tgt?.name}\n`;
    code += `    # ${edge.eq}\n\n`;
  });

  code += `    return derivatives

class SimulationView(View):
    def post(self, request):
        import json
        data = json.loads(request.body)
        t_start = data.get('start', 0)
        t_end = data.get('end', 100)
        dt = data.get('dt', 0.25)
        
        # Initialize and run simulation
        results = {'time': [], 'states': []}
        return JsonResponse(results)
`;

  return code;
}

function generateUrls() {
  return `from django.urls import path
from .views import SimulationView

urlpatterns = [
    path('api/simulate/', SimulationView.as_view(), name='simulation'),
]
`;
}

function copyExport() {
  navigator.clipboard.writeText(document.getElementById('export-content').textContent);
}

function downloadExport() {
  [
    { name: 'models.py', content: generateModels() },
    { name: 'views.py', content: generateViews() },
    { name: 'urls.py', content: generateUrls() }
  ].forEach(f => {
    const blob = new Blob([f.content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    a.click();
  });
}

// Django Import
function openDjangoImportModal() {
  modalKind = 'django-import';
  document.getElementById('modal-title').textContent = 'Import from Django models.py';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-hint" style="margin-bottom:8px">
      Paste your Django <code>models.py</code> content below. Classes with numeric fields will become Objects with Stock/Constant nodes. <code>ForeignKey</code> relationships become Links.
    </div>
    <div class="form-row">
      <label>models.py content</label>
      <textarea id="m-django-code" style="min-height:180px;font-size:10px" placeholder="from django.db import models&#10;&#10;class Reservoir(models.Model):&#10;    volume = models.FloatField(default=1000)&#10;    max_capacity = models.FloatField(default=5000)&#10;    ..."></textarea>
    </div>
    <div class="form-row">
      <label>Import mode</label>
      <select id="m-import-mode">
        <option value="replace">Replace current model</option>
        <option value="append">Append to current model</option>
      </select>
    </div>
    <div id="m-django-preview" style="font-size:10px;color:var(--text-secondary);margin-top:6px"></div>
  `;
  document.getElementById('modal-buttons').innerHTML = `
    <button onclick="closeModal()">Cancel</button>
    <button onclick="previewDjangoImport()">Preview</button>
    <button class="primary" onclick="confirmDjangoImport()">Import</button>
  `;
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('m-django-code').focus(), 50);
}

function parseDjangoModels(code) {
  const importedObjects = [];
  const importedNodes = [];
  const importedEdges = [];

  // Extract class blocks
  const classRe = /class\s+(\w+)\s*\(([^)]*)\)\s*:/g;
  const classMatches = [];
  let m;
  while ((m = classRe.exec(code)) !== null) {
    classMatches.push({ name: m[1], bases: m[2], bodyStart: m.index + m[0].length });
  }

  const NUMERIC = ['FloatField','IntegerField','DecimalField','PositiveIntegerField',
                   'PositiveSmallIntegerField','BigIntegerField','SmallIntegerField'];
  const RELATION = ['ForeignKey','OneToOneField','ManyToManyField'];

  const parsedClasses = [];
  classMatches.forEach((cls, idx) => {
    const body = idx < classMatches.length - 1
      ? code.slice(cls.bodyStart, classMatches[idx + 1].bodyStart)
      : code.slice(cls.bodyStart);

    if (cls.name === 'Meta' || cls.name === 'Migration') return;

    const fields = [];
    const fieldRe = /^\s{4}(\w+)\s*=\s*models\.(\w+)\s*\(([^)]*)\)/gm;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      if (fm[1] === 'class') continue;
      fields.push({ name: fm[1], fieldType: fm[2], args: fm[3] });
    }
    if (fields.length === 0) return;
    parsedClasses.push({ name: cls.name, fields });
  });

  // Layout grid
  const COLS = 3, OBJ_W = 200, GAP_X = 60, GAP_Y = 40, START_X = 80, START_Y = 80;
  const objMap = {}; // className -> { obj, firstNode }

  parsedClasses.forEach((cls, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const numericFields = cls.fields.filter(f => NUMERIC.includes(f.fieldType));
    if (numericFields.length === 0) return;

    const objH = Math.max(120, 50 + numericFields.length * 50);
    const x = START_X + col * (OBJ_W + GAP_X);
    const y = START_Y + row * (objH + GAP_Y);

    const objId = genId();
    const obj = { id: objId, name: cls.name, x, y, w: OBJ_W, h: objH };
    importedObjects.push(obj);

    let nodeY = y + 45;
    let firstNode = null;
    numericFields.forEach(f => {
      const defaultMatch = f.args.match(/default\s*=\s*([\d.eE+\-]+)/);
      const eq = defaultMatch ? defaultMatch[1] : '0';
      // Heuristic: rate/factor/coeff/param → const, otherwise stock
      const isConst = /rate|factor|coeff|param|max|min|threshold|alpha|beta|gamma/i.test(f.name);
      const type = isConst ? 'const' : 'stock';
      const nodeId = genId();
      const node = { id: nodeId, type, name: f.name, eq, units: '', x: x + OBJ_W / 2, y: nodeY, objectId: objId };
      importedNodes.push(node);
      if (!firstNode) firstNode = node;
      nodeY += 50;
    });
    objMap[cls.name] = { obj, firstNode };
  });

  // ForeignKey / OneToOneField → link edges
  parsedClasses.forEach(cls => {
    cls.fields.filter(f => RELATION.includes(f.fieldType)).forEach(f => {
      const toMatch = f.args.match(/['"]([\w.]+)['"]/);
      if (!toMatch) return;
      const targetName = toMatch[1].split('.').pop();
      const src = objMap[cls.name];
      const tgt = objMap[targetName];
      if (src?.firstNode && tgt?.firstNode) {
        importedEdges.push({ id: genId(), type: 'link', src: src.firstNode.id, tgt: tgt.firstNode.id, eq: '', units: '' });
      }
    });
  });

  return { objects: importedObjects, nodes: importedNodes, edges: importedEdges };
}

function previewDjangoImport() {
  const code = document.getElementById('m-django-code').value;
  if (!code.trim()) return;
  const result = parseDjangoModels(code);
  document.getElementById('m-django-preview').innerHTML =
    `<strong>Preview:</strong> ${result.objects.length} object(s), ${result.nodes.length} node(s), ${result.edges.length} link(s) will be imported.`;
}

function confirmDjangoImport() {
  const code = document.getElementById('m-django-code').value;
  if (!code.trim()) { closeModal(); return; }
  const mode = document.getElementById('m-import-mode').value;
  const result = parseDjangoModels(code);
  if (result.objects.length === 0 && result.nodes.length === 0) {
    document.getElementById('m-django-preview').innerHTML =
      '<span style="color:var(--text-error)">No importable models found. Make sure classes have FloatField/IntegerField fields.</span>';
    return;
  }
  if (mode === 'replace') {
    objects = result.objects;
    nodes = result.nodes;
    edges = result.edges;
  } else {
    objects.push(...result.objects);
    nodes.push(...result.nodes);
    edges.push(...result.edges);
  }
  closeModal();
  renderAll();
}

// JSON Export/Import
function exportJSON() {
  const data = { objects, nodes, edges, idCounter };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'system_dynamics_model.json';
  a.click();
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        objects = data.objects || [];
        nodes = data.nodes || [];
        edges = data.edges || [];
        idCounter = data.idCounter || 0;
        renderAll();
      } catch { alert('Invalid JSON'); }
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}

// MDL Export
function exportMDL() {
  let mdl = '{UTF-8}\n{Exported from System Dynamics Builder}\n\n';
  
  nodes.filter(n => n.type === 'stock').forEach(n => {
    const inflows = edges.filter(e => e.tgt === n.id && e.type === 'flow').map(e => e.eq || '0');
    const outflows = edges.filter(e => e.src === n.id && e.type === 'flow').map(e => e.eq || '0');
    mdl += `${n.name}= INTEG (\n\t${inflows.join('+')||'0'}-${outflows.join('-')||'0'},\n\t${n.eq||'0'})\n\t~\t${n.units||'units'}\n\t~\t|\n\n`;
  });
  
  nodes.filter(n => n.type === 'flow').forEach(n => {
    mdl += `${n.name}=\n\t${n.eq||'0'}\n\t~\t${n.units||'units/time'}\n\t~\t|\n\n`;
  });
  
  nodes.filter(n => n.type === 'aux').forEach(n => {
    mdl += `${n.name}=\n\t${n.eq||'0'}\n\t~\t${n.units||'dimensionless'}\n\t~\t|\n\n`;
  });
  
  nodes.filter(n => n.type === 'const').forEach(n => {
    mdl += `${n.name}=\n\t${n.eq||'0'}\n\t~\t${n.units||'dimensionless'}\n\t~\t|\n\n`;
  });
  
  mdl += `FINAL TIME = 100\n\t~\tTime\n\t~\t|\n\nINITIAL TIME = 0\n\t~\tTime\n\t~\t|\n\nTIME STEP = 0.25\n\t~\tTime\n\t~\t|\n`;
  
  const blob = new Blob([mdl], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'model.mdl';
  a.click();
}

// Simulation
let simChart = null;
let simResults = null;
let visibleVars = {};

function openRunPanel() {
  document.getElementById('run-panel').classList.add('open');
  runSimulation();
}

function closeRunPanel() {
  document.getElementById('run-panel').classList.remove('open');
}

function showRunError(msg) {
  document.getElementById('run-error').textContent = msg;
  document.getElementById('run-error').style.display = 'block';
  document.getElementById('run-body').style.display = 'none';
}

function clearRunError() {
  document.getElementById('run-error').style.display = 'none';
  document.getElementById('run-body').style.display = 'flex';
}

function evalExpr(expr, state, constMap) {
  if (!expr || expr.trim() === '') return 0;
  let e = expr.trim();
  const allNames = [...Object.keys(state), ...Object.keys(constMap)].sort((a, b) => b.length - a.length);
  for (const name of allNames) {
    const val = name in state ? state[name] : constMap[name];
    if (!isNaN(val)) {
      e = e.replace(new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), String(val));
    }
  }
  e = e.replace(/\^/g, '**');
  try { return Function('"use strict"; return (' + e + ')')(); } catch { return NaN; }
}

function runSimulation() {
  const stockNodes = nodes.filter(n => n.type === 'stock');
  if (stockNodes.length === 0) {
    showRunError('Add at least one Stock to run simulation.');
    return;
  }
  clearRunError();
  
  const tStart = parseFloat(document.getElementById('sim-start').value) || 0;
  const tEnd = parseFloat(document.getElementById('sim-end').value) || 100;
  const dt = parseFloat(document.getElementById('sim-dt').value) || 0.25;
  
  const constMap = {};
  nodes.filter(n => n.type === 'const').forEach(n => { constMap[n.name] = parseFloat(n.eq) || 0; });
  
  let stockState = {};
  stockNodes.forEach(n => { stockState[n.name] = parseFloat(n.eq) || 0; });
  
  const times = [];
  const series = {};
  const tracked = nodes.filter(n => n.type !== 'const');
  tracked.forEach(n => { series[n.name] = []; });
  
  let t = tStart;
  while (t <= tEnd + dt * 0.001) {
    times.push(t);
    const state = { ...stockState };
    
    // Compute aux first
    nodes.filter(n => n.type === 'aux').forEach(n => {
      state[n.name] = evalExpr(n.eq, state, constMap);
    });
    
    // Compute flows (from edges)
    nodes.filter(n => n.type === 'flow').forEach(n => {
      state[n.name] = evalExpr(n.eq, state, constMap);
    });
    
    tracked.forEach(n => { series[n.name].push(state[n.name] ?? 0); });
    
    if (t >= tEnd) break;
    
    // Integration using edge equations
    const derivs = {};
    stockNodes.forEach(n => {
      const inflows = edges.filter(e => e.tgt === n.id && e.type === 'flow')
        .map(e => evalExpr(e.eq, state, constMap));
      const outflows = edges.filter(e => e.src === n.id && e.type === 'flow')
        .map(e => evalExpr(e.eq, state, constMap));
      derivs[n.name] = inflows.reduce((a, b) => a + b, 0) - outflows.reduce((a, b) => a + b, 0);
    });
    
    stockNodes.forEach(n => { stockState[n.name] += derivs[n.name] * dt; });
    t += dt;
  }
  
  simResults = { times, series, tracked };
  tracked.forEach(n => { if (!(n.name in visibleVars)) visibleVars[n.name] = n.type === 'stock'; });
  
  buildVarToggles(tracked);
  drawChart(times, series, tracked);
}

const SIM_COLORS = ['#378ADD', '#639922', '#D85A30', '#7F77DD', '#1D9E75', '#BA7517', '#D4537E'];

function buildVarToggles(tracked) {
  const container = document.getElementById('var-toggles');
  container.innerHTML = '';
  tracked.forEach((n, i) => {
    const color = SIM_COLORS[i % SIM_COLORS.length];
    const label = document.createElement('label');
    label.className = 'var-toggle';
    label.innerHTML = `<input type="checkbox" ${visibleVars[n.name] ? 'checked' : ''}><span class="var-dot" style="background:${color}"></span><span>${n.name.slice(0, 12)}</span>`;
    label.querySelector('input').onchange = e => {
      visibleVars[n.name] = e.target.checked;
      if (simResults) drawChart(simResults.times, simResults.series, simResults.tracked);
    };
    container.appendChild(label);
  });
}

function drawChart(times, series, tracked) {
  const datasets = tracked.map((n, i) => ({
    label: n.name,
    data: series[n.name],
    borderColor: SIM_COLORS[i % SIM_COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: n.type === 'stock' ? 2 : 1.5,
    pointRadius: 0,
    tension: 0.3,
    hidden: !visibleVars[n.name]
  }));
  
  const ctx = document.getElementById('sim-chart').getContext('2d');
  if (simChart) simChart.destroy();
  
  simChart = new Chart(ctx, {
    type: 'line',
    data: { labels: times.map(t => t.toFixed(1)), datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 9 } }, grid: { color: DARK ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)' } },
        y: { ticks: { maxTicksLimit: 6, font: { size: 9 } }, grid: { color: DARK ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)' } }
      }
    }
  });
}

// Grid
function drawGrid() {
  gridLayer.innerHTML = '';
  const G = 20;
  // Adaptive dot spacing: skip dots when zoomed out far to keep performance
  const step = viewBox.w > 4000 ? G * 4 : viewBox.w > 2000 ? G * 2 : G;
  const startX = Math.floor(viewBox.x / step) * step;
  const startY = Math.floor(viewBox.y / step) * step;
  const endX = viewBox.x + viewBox.w;
  const endY = viewBox.y + viewBox.h;
  // Scale dot radius with zoom so dots don't vanish or become huge
  const dotR = Math.max(0.5, Math.min(2, viewBox.w / 1400));
  for (let x = startX; x <= endX; x += step) {
    for (let y = startY; y <= endY; y += step) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x);
      c.setAttribute('cy', y);
      c.setAttribute('r', dotR);
      c.classList.add('grid-dot');
      gridLayer.appendChild(c);
    }
  }
}

// Demo
function loadDemo() {
  objects = [{ id: 'o1', name: 'WaterReservoir', x: 100, y: 80, w: 200, h: 160 }];
  nodes = [
    { id: 'n1', type: 'stock', name: 'volume', eq: '1000', units: 'm3', x: 200, y: 160, objectId: 'o1' },
    { id: 'n2', type: 'const', name: 'max_capacity', eq: '5000', units: 'm3', x: 200, y: 200, objectId: 'o1' },
    { id: 'n5', type: 'aux', name: 'rainfall_rate', eq: '50', units: 'm3/day', x: 450, y: 100, objectId: null },
    { id: 'n6', type: 'aux', name: 'demand_rate', eq: '30', units: 'm3/day', x: 450, y: 220, objectId: null }
  ];
  edges = [
    { id: 'e1', type: 'flow', src: 'n5', tgt: 'n1', eq: 'rainfall_rate', units: 'm3/day' },
    { id: 'e2', type: 'flow', src: 'n1', tgt: 'n6', eq: 'demand_rate', units: 'm3/day' }
  ];
  idCounter = 6;
  renderAll();
}

// Initialize viewBox to match actual canvas size
(function initViewBox() {
  const rect = canvas.getBoundingClientRect();
  viewBox.w = rect.width || 1400;
  viewBox.h = rect.height || 900;
})();
applyViewBox();
drawGrid();
if (!loadFromStorage()) loadDemo();
renderAll();
setTool('select');
updateZoomDisplay();
