const canvas = document.getElementById('canvas');
const gridLayer = document.getElementById('grid-layer');
const appsLayer = document.getElementById('apps-layer');
const objectsLayer = document.getElementById('objects-layer');
const edgesLayer = document.getElementById('edges-layer');
const nodesLayer = document.getElementById('nodes-layer');
const previewLayer = document.getElementById('preview-layer');

const DARK = window.matchMedia('(prefers-color-scheme: dark)').matches;

const COLORS = {
  app: { fill: DARK ? '#042f2e' : '#f0fdfa', stroke: DARK ? '#0d9488' : '#0d9488', text: DARK ? '#5eead4' : '#0f766e' },
  object: { fill: DARK ? '#22261c' : '#f5f7f0', stroke: DARK ? '#6a7a50' : '#8a9a6a', text: DARK ? '#a8b890' : '#4a5a3a' },
  stock: { fill: DARK ? '#172554' : '#eff6ff', stroke: '#3b82f6', text: DARK ? '#93bbfd' : '#1d4ed8' },
  flow: { fill: DARK ? '#14280b' : '#f0fdf4', stroke: '#22c55e', text: DARK ? '#86efac' : '#15803d' },
  aux: { fill: DARK ? '#431407' : '#fff7ed', stroke: '#f97316', text: DARK ? '#fdba74' : '#c2410c' },
  const: { fill: DARK ? '#2e1065' : '#f5f3ff', stroke: '#8b5cf6', text: DARK ? '#c4b5fd' : '#6d28d9' }
};

let tool = 'object';
let apps = [];
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
  app: 'Click canvas to place a Django App container',
  object: 'Click canvas (or inside an App) to place a Django Model object',
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

// App functions
function createApp(x, y) {
  const id = genId();
  const app = { id, name: 'App_' + idCounter, x, y, w: 340, h: 240 };
  apps.push(app);
  return app;
}

function getAppAt(x, y) {
  for (let i = apps.length - 1; i >= 0; i--) {
    const a = apps[i];
    if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a;
  }
  return null;
}

function getObjectsInApp(appId) {
  return objects.filter(o => o.appId === appId);
}

function resizeAppToFit(app) {
  const children = getObjectsInApp(app.id);
  if (children.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  children.forEach(o => {
    minX = Math.min(minX, o.x - 20);
    minY = Math.min(minY, o.y - 32); // 32 leaves room for the label badge
    maxX = Math.max(maxX, o.x + o.w + 20);
    maxY = Math.max(maxY, o.y + o.h + 20);
  });
  // Exact fit — shrinks as well as grows
  app.x = minX;
  app.y = minY;
  app.w = maxX - minX;
  app.h = maxY - minY;
}

// Object functions
function createObject(x, y) {
  const id = genId();
  const app = getAppAt(x, y);
  const obj = { id, name: 'Object_' + idCounter, x, y, w: 160, h: 100, appId: app?.id || null };
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
    const hh = r.hh || r.r || 22;
    minX = Math.min(minX, n.x - hw - 10);
    minY = Math.min(minY, n.y - hh - 24); // 24 = label row above node
    maxX = Math.max(maxX, n.x + hw + 10);
    maxY = Math.max(maxY, n.y + hh + 14);
  });
  // Exact fit — shrinks as well as grows; enforce minimum size
  obj.x = minX;
  obj.y = minY;
  obj.w = Math.max(120, maxX - minX);
  obj.h = Math.max(80, maxY - minY);
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
  const charW = 6.2; // approximate px per character at font-size 10
  const textHalfW = Math.ceil(((n.name || '').length * charW) / 2);
  if (n.type === 'stock') return { hw: Math.max(44, textHalfW + 14), hh: 22 };
  if (n.type === 'flow') return { hw: Math.max(28, textHalfW + 12), hh: 18 };
  if (n.type === 'aux') return { r: Math.max(22, textHalfW + 10) };
  return { r: Math.max(18, textHalfW + 10) };
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
  appsLayer.innerHTML = '';
  objectsLayer.innerHTML = '';
  edgesLayer.innerHTML = '';
  nodesLayer.innerHTML = '';
  apps.forEach(renderApp);
  objects.forEach(renderObject);
  edges.forEach(renderEdge);
  nodes.forEach(renderNode);
  updateTree();
  saveToStorage();
}

function renderApp(app) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', app.id);
  const isSelected = selectedType === 'app' && selectedId === app.id;
  const ca = COLORS.app;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', app.x);
  rect.setAttribute('y', app.y);
  rect.setAttribute('width', app.w);
  rect.setAttribute('height', app.h);
  rect.setAttribute('rx', 14);
  rect.setAttribute('fill', ca.fill);
  rect.setAttribute('stroke', isSelected ? '#3b82f6' : ca.stroke);
  rect.setAttribute('stroke-width', isSelected ? 2.5 : 1.5);
  rect.setAttribute('stroke-dasharray', isSelected ? '6 3' : '8 4');
  g.appendChild(rect);

  // App label badge at top-left
  const badgeW = Math.max(80, app.name.length * 7 + 24);
  const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  badge.setAttribute('x', app.x + 10);
  badge.setAttribute('y', app.y - 11);
  badge.setAttribute('width', badgeW);
  badge.setAttribute('height', 20);
  badge.setAttribute('rx', 5);
  badge.setAttribute('fill', isSelected ? '#3b82f6' : ca.stroke);
  g.appendChild(badge);

  const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  lbl.textContent = '⬡ ' + app.name;
  lbl.setAttribute('x', app.x + 10 + badgeW / 2);
  lbl.setAttribute('y', app.y - 1);
  lbl.setAttribute('text-anchor', 'middle');
  lbl.setAttribute('dominant-baseline', 'middle');
  lbl.setAttribute('fill', '#ffffff');
  lbl.setAttribute('font-size', '10');
  lbl.setAttribute('font-weight', '700');
  lbl.setAttribute('font-family', "'Inter', system-ui, sans-serif");
  lbl.setAttribute('letter-spacing', '0.03em');
  lbl.style.pointerEvents = 'none';
  g.appendChild(lbl);

  g.style.cursor = 'move';
  g.addEventListener('mousedown', e => onAppMouseDown(e, app));
  appsLayer.appendChild(g);
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
  line.setAttribute('stroke', tool === 'flow' ? '#22c55e' : '#a1a1aa');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-dasharray', '6 3');
  line.setAttribute('opacity', '0.6');
  line.setAttribute('pointer-events', 'none');
  previewLayer.appendChild(line);
}

// localStorage persistence
function saveToStorage() {
  try {
    localStorage.setItem('sd_model', JSON.stringify({ apps, objects, nodes, edges, idCounter }));
  } catch(e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('sd_model');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.nodes?.length && !data.objects?.length && !data.apps?.length) return false;
    apps = data.apps || [];
    objects = data.objects || [];
    nodes = data.nodes || [];
    edges = data.edges || [];
    idCounter = data.idCounter || 0;
    return true;
  } catch(e) { return false; }
}

function newModel() {
  if (!confirm('Start a new model? Unsaved changes will be lost.')) return;
  apps = []; objects = []; nodes = []; edges = []; idCounter = 0;
  localStorage.removeItem('sd_model');
  renderAll();
  setTool('select');
}

function renderObject(obj) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', obj.id);
  const isSelected = selectedType === 'object' && selectedId === obj.id;
  const co = COLORS.object;

  // Tooltip
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  const parentApp = apps.find(a => a.id === obj.appId);
  title.textContent = obj.name + (parentApp ? ' (app: ' + parentApp.name + ')' : '');
  g.appendChild(title);

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', obj.x);
  rect.setAttribute('y', obj.y);
  rect.setAttribute('width', obj.w);
  rect.setAttribute('height', obj.h);
  rect.setAttribute('rx', 10);
  rect.setAttribute('fill', co.fill);
  rect.setAttribute('stroke', isSelected ? '#3b82f6' : co.stroke);
  rect.setAttribute('stroke-width', isSelected ? 2 : 1);
  if (isSelected) rect.setAttribute('stroke-dasharray', '4 2');
  g.appendChild(rect);

  // Object name
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.textContent = obj.name;
  txt.setAttribute('x', obj.x + 8);
  txt.setAttribute('y', obj.y + 14);
  txt.setAttribute('fill', co.text);
  txt.setAttribute('font-size', '10');
  txt.setAttribute('font-weight', '600');
  txt.setAttribute('font-family', "'Inter', system-ui, sans-serif");
  g.appendChild(txt);

  // App membership badge (small tag top-right)
  if (parentApp) {
    const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tag.textContent = parentApp.name;
    tag.setAttribute('x', obj.x + obj.w - 6);
    tag.setAttribute('y', obj.y + 13);
    tag.setAttribute('text-anchor', 'end');
    tag.setAttribute('fill', COLORS.app.stroke);
    tag.setAttribute('font-size', '8');
    tag.setAttribute('font-weight', '500');
    tag.setAttribute('font-family', "'Inter', system-ui, sans-serif");
    tag.setAttribute('opacity', '0.7');
    tag.style.pointerEvents = 'none';
    g.appendChild(tag);
  }

  g.style.cursor = 'move';
  g.addEventListener('mousedown', e => onObjectMouseDown(e, obj));
  objectsLayer.appendChild(g);
}

function renderNode(n) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', n.id);
  const c = COLORS[n.type];
  const isSelected = selectedType === 'node' && selectedId === n.id;
  const r = nodeRadius(n);

  // Tooltip
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = `${n.name}${n.eq ? ' = ' + n.eq : ''}${n.units ? ' [' + n.units + ']' : ''}`;
  g.appendChild(title);

  if (n.type === 'stock') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', n.x - r.hw);
    rect.setAttribute('y', n.y - r.hh);
    rect.setAttribute('width', r.hw * 2);
    rect.setAttribute('height', r.hh * 2);
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', c.fill);
    rect.setAttribute('stroke', isSelected ? '#3b82f6' : c.stroke);
    rect.setAttribute('stroke-width', isSelected ? 2 : 1.5);
    g.appendChild(rect);
  } else if (n.type === 'flow') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', n.x - r.hw);
    rect.setAttribute('y', n.y - r.hh);
    rect.setAttribute('width', r.hw * 2);
    rect.setAttribute('height', r.hh * 2);
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', c.fill);
    rect.setAttribute('stroke', isSelected ? '#3b82f6' : c.stroke);
    rect.setAttribute('stroke-width', 1.5);
    rect.setAttribute('stroke-dasharray', '4 2');
    g.appendChild(rect);
  } else if (n.type === 'aux') {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', r.r);
    circle.setAttribute('fill', c.fill);
    circle.setAttribute('stroke', isSelected ? '#3b82f6' : c.stroke);
    circle.setAttribute('stroke-width', 1.5);
    g.appendChild(circle);
  } else { // const
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', r.r);
    circle.setAttribute('fill', c.fill);
    circle.setAttribute('stroke', isSelected ? '#3b82f6' : c.stroke);
    circle.setAttribute('stroke-width', 1);
    g.appendChild(circle);
    const ul = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ul.setAttribute('x1', n.x - r.r * 0.65);
    ul.setAttribute('y1', n.y + r.r * 0.78);
    ul.setAttribute('x2', n.x + r.r * 0.65);
    ul.setAttribute('y2', n.y + r.r * 0.78);
    ul.setAttribute('stroke', c.stroke);
    ul.setAttribute('stroke-width', '1');
    g.appendChild(ul);
  }

  // Full name (no truncation)
  const hasEqRow = n.eq && n.type !== 'aux';
  const nameY = n.y + (hasEqRow ? -6 : 0);
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.textContent = n.name;
  txt.setAttribute('x', n.x);
  txt.setAttribute('y', nameY);
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('dominant-baseline', 'middle');
  txt.setAttribute('fill', c.text);
  txt.setAttribute('font-size', '10');
  txt.setAttribute('font-family', "'Inter', system-ui, sans-serif");
  txt.setAttribute('font-weight', '600');
  txt.style.pointerEvents = 'none';
  g.appendChild(txt);

  // Equation + units row
  if (hasEqRow) {
    const eqTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const shortEq = n.eq.length > 10 ? n.eq.slice(0, 9) + '…' : n.eq;
    eqTxt.textContent = shortEq + (n.units ? ' ' + n.units : '');
    eqTxt.setAttribute('x', n.x);
    eqTxt.setAttribute('y', n.y + 7);
    eqTxt.setAttribute('text-anchor', 'middle');
    eqTxt.setAttribute('fill', c.text);
    eqTxt.setAttribute('font-size', '8');
    eqTxt.setAttribute('font-family', "'SF Mono', 'Cascadia Code', monospace");
    eqTxt.setAttribute('opacity', '0.65');
    eqTxt.style.pointerEvents = 'none';
    g.appendChild(eqTxt);
  }

  // Units label outside aux/flow circles (no eq row)
  if (n.units && (n.type === 'aux' || (n.type === 'flow' && !n.eq))) {
    const unitTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    unitTxt.textContent = n.units;
    unitTxt.setAttribute('x', n.x);
    unitTxt.setAttribute('y', n.y + r.r + 11);
    unitTxt.setAttribute('text-anchor', 'middle');
    unitTxt.setAttribute('fill', c.text);
    unitTxt.setAttribute('font-size', '8');
    unitTxt.setAttribute('font-family', "'SF Mono', 'Cascadia Code', monospace");
    unitTxt.setAttribute('opacity', '0.5');
    unitTxt.style.pointerEvents = 'none';
    g.appendChild(unitTxt);
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
    line.setAttribute('stroke', isSelected ? '#3b82f6' : '#22c55e');
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
      label.setAttribute('fill', DARK ? '#86efac' : '#15803d');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', "'SF Mono', 'Cascadia Code', 'Fira Code', monospace");
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
    path.setAttribute('stroke', isSelected ? '#3b82f6' : (DARK ? '#71717a' : '#a1a1aa'));
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

function makeTreeObject(obj) {
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
  return div;
}

function updateTree() {
  const tree = document.getElementById('objects-tree');
  tree.innerHTML = '';

  // Apps and their objects
  apps.forEach(app => {
    const appDiv = document.createElement('div');
    appDiv.style.cssText = 'margin-bottom:8px;border:1.5px solid ' + COLORS.app.stroke + ';border-radius:10px;overflow:hidden;';
    const appHeader = document.createElement('div');
    appHeader.style.cssText = `padding:7px 10px;background:${COLORS.app.fill};border-bottom:1px solid ${COLORS.app.stroke};font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;color:${COLORS.app.text}`;
    appHeader.innerHTML = `<svg width="10" height="10"><rect x="0" y="2" width="10" height="8" rx="2" fill="none" stroke="${COLORS.app.stroke}" stroke-width="1.5"/><rect x="3" y="0" width="4" height="3" rx="1" fill="${COLORS.app.stroke}"/></svg> ${app.name}`;
    appHeader.onclick = () => selectApp(app);
    appDiv.appendChild(appHeader);
    const appChildren = document.createElement('div');
    appChildren.style.cssText = 'padding:4px;';
    getObjectsInApp(app.id).forEach(obj => appChildren.appendChild(makeTreeObject(obj)));
    appDiv.appendChild(appChildren);
    tree.appendChild(appDiv);
  });

  // Objects not in any app
  objects.filter(o => !o.appId).forEach(obj => tree.appendChild(makeTreeObject(obj)));

  // Standalone nodes
  nodes.filter(n => !n.objectId).forEach(n => {
    const item = document.createElement('div');
    item.className = 'tree-standalone' + (selectedType === 'node' && selectedId === n.id ? ' selected' : '');
    item.innerHTML = `<span class="tree-item-dot" style="background:${COLORS[n.type].stroke}"></span> ${n.name}`;
    item.onclick = () => selectNode(n);
    tree.appendChild(item);
  });

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
      item.innerHTML = `<span style="color:${e.type === 'flow' ? '#22c55e' : '#a1a1aa'}">${e.type === 'flow' ? '→' : '⤳'}</span> ${src?.name || '?'} → ${tgt?.name || '?'}`;
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
  if (selectedType === 'app') {
    // Delete app and detach its objects (keep objects as standalone)
    objects.filter(o => o.appId === selectedId).forEach(o => { o.appId = null; });
    apps = apps.filter(a => a.id !== selectedId);
  } else if (selectedType === 'object') {
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

function selectApp(app) {
  selectedType = 'app';
  selectedId = app.id;
  renderAll();
}

function onAppMouseDown(e, app) {
  e.stopPropagation();
  const now = Date.now();
  if (lastClickId === app.id && now - lastClickTime < 350) {
    openAppModal(app);
    lastClickTime = 0; lastClickId = null;
    return;
  }
  lastClickTime = now;
  lastClickId = app.id;
  if (tool === 'select') {
    selectApp(app);
    dragging = { type: 'app', app };
    const pos = getCanvasPos(e);
    dragOffset = { x: pos.x - app.x, y: pos.y - app.y };
  }
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
  
  if (tool === 'app') {
    const app = createApp(sx - 170, sy - 120);
    renderAll();
    selectApp(app);
    openAppModal(app);
  } else if (tool === 'object') {
    const obj = createObject(sx - 80, sy - 50);
    if (obj.appId) resizeAppToFit(apps.find(a => a.id === obj.appId));
    renderAll();
    selectObject(obj);
    openObjectModal(obj);
  } else if (tool === 'stock' || tool === 'const') {
    const obj = getObjectAt(sx, sy);
    const n = createNode(tool, sx, sy, obj?.id);
    if (obj) {
      resizeObjectToFit(obj);
      if (obj.appId) {
        const parentApp = apps.find(a => a.id === obj.appId);
        if (parentApp) resizeAppToFit(parentApp);
      }
    }
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
  if (dragging.type === 'app') {
    const app = dragging.app;
    const newX = pos.x - dragOffset.x;
    const newY = pos.y - dragOffset.y;
    const dx = newX - app.x, dy = newY - app.y;
    app.x = newX; app.y = newY;
    getObjectsInApp(app.id).forEach(o => {
      o.x += dx; o.y += dy;
      getNodesInObject(o.id).forEach(n => { n.x += dx; n.y += dy; });
    });
  } else if (dragging.type === 'object') {
    const obj = dragging.obj;
    const newX = pos.x - dragOffset.x;
    const newY = pos.y - dragOffset.y;
    const dx = newX - obj.x, dy = newY - obj.y;
    obj.x = newX;
    obj.y = newY;
    getNodesInObject(obj.id).forEach(n => { n.x += dx; n.y += dy; });
    // Resize parent app to track the moved object
    if (obj.appId) {
      const parentApp = apps.find(a => a.id === obj.appId);
      if (parentApp) resizeAppToFit(parentApp);
    }
  } else if (dragging.type === 'node') {
    const n = dragging.node;
    n.x = pos.x - dragOffset.x;
    n.y = pos.y - dragOffset.y;
    const obj = getObjectAt(n.x, n.y);
    if ((n.type === 'stock' || n.type === 'const') && obj) {
      n.objectId = obj.id;
      resizeObjectToFit(obj);
      // Resize parent app to track the resized object
      if (obj.appId) {
        const parentApp = apps.find(a => a.id === obj.appId);
        if (parentApp) resizeAppToFit(parentApp);
      }
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
  if (nodes.length === 0 && objects.length === 0 && apps.length === 0) {
    viewBox = { x: 0, y: 0, w: 1400, h: 900 };
    currentZoom = 1;
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    apps.forEach(a => {
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y - 14); // account for label badge
      maxX = Math.max(maxX, a.x + a.w);
      maxY = Math.max(maxY, a.y + a.h);
    });
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
  if (e.key === 'a' || e.key === 'A') setTool('app');
  if (e.key === 'o' || e.key === 'O') setTool('object');
  if (e.key === 's' || e.key === 'S') setTool('stock');
  if (e.key === 'c' || e.key === 'C') setTool('const');
  if (e.key === 'x' || e.key === 'X') setTool('aux');
  if (e.key === 'f' || e.key === 'F') setTool('flow');
  if (e.key === 'l' || e.key === 'L') setTool('link');
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === '+' || e.key === '=') zoomIn();
  if (e.key === '-') zoomOut();
  if (e.key === '0') zoomFit();
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
function openAppModal(app) {
  modalTarget = app;
  modalKind = 'app';
  document.getElementById('modal-title').textContent = 'Edit Django App';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-hint" style="margin-bottom:10px">
      An App groups related Django Models. It maps to a Django app folder (e.g. <code>myapp/</code>).
    </div>
    <div class="form-row">
      <label>App Name</label>
      <input id="m-name" type="text" value="${app.name}" placeholder="e.g. reservoir_app">
      <div class="form-hint">Use snake_case — this becomes the Django app name</div>
    </div>
  `;
  document.getElementById('modal-buttons').innerHTML = `
    <button onclick="closeModal()">Cancel</button>
    <button class="primary" onclick="saveModal()">Save</button>
  `;
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('m-name').focus(), 50);
}

function openObjectModal(obj) {
  modalTarget = obj;
  modalKind = 'object';
  const appOptions = apps.map(a =>
    `<option value="${a.id}" ${obj.appId === a.id ? 'selected' : ''}>${a.name}</option>`
  ).join('');
  document.getElementById('modal-title').textContent = 'Edit Object (Django Model)';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <label>Name (Django Model Name)</label>
      <input id="m-name" type="text" value="${obj.name}" placeholder="e.g. WaterReservoir">
      <div class="form-hint">Use PascalCase for Django model naming</div>
    </div>
    ${apps.length ? `
    <div class="form-row">
      <label>Django App</label>
      <select id="m-app-id">
        <option value="">— No app (standalone) —</option>
        ${appOptions}
      </select>
      <div class="form-hint">Assign to a Django App for organized code generation</div>
    </div>
    ` : ''}
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
  
  if (modalKind === 'app') {
    const name = document.getElementById('m-name').value.trim().replace(/\s+/g, '_');
    modalTarget.name = name || modalTarget.name;
  } else if (modalKind === 'object') {
    const name = document.getElementById('m-name').value.trim().replace(/\s+/g, '_');
    modalTarget.name = name || modalTarget.name;
    const appSel = document.getElementById('m-app-id');
    if (appSel) {
      modalTarget.appId = appSel.value || null;
      if (modalTarget.appId) resizeAppToFit(apps.find(a => a.id === modalTarget.appId));
    }
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
      <button class="export-tab" onclick="showExportTab(this, 'apps')">apps.py</button>
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
  document.getElementById('export-content').textContent = { models: generateModels, views: generateViews, urls: generateUrls, apps: generateAppsConfig }[tab]();
}

function generateModels() {
  const header = `from django.contrib.gis.db import models\n\nclass SystemDynamicsBase(models.Model):\n    """Base class for all system dynamics objects"""\n    name = models.CharField(max_length=100)\n    geometry = models.PointField(null=True, blank=True, srid=4326)\n    created_at = models.DateTimeField(auto_now_add=True)\n    updated_at = models.DateTimeField(auto_now=True)\n\n    class Meta:\n        abstract = True\n\n`;

  function modelBlock(obj) {
    const children = getNodesInObject(obj.id);
    const stocks = children.filter(n => n.type === 'stock');
    const consts = children.filter(n => n.type === 'const');
    const parentApp = apps.find(a => a.id === obj.appId);
    let block = `class ${obj.name}(SystemDynamicsBase):\n    """${obj.name} - System Dynamics Model${parentApp ? ' | App: ' + parentApp.name : ''}"""\n`;
    stocks.forEach(s => {
      block += `    ${s.name} = models.FloatField(default=${s.eq || 0}, help_text='Stock: ${s.units || 'units'}')\n`;
    });
    consts.forEach(c => {
      block += `    ${c.name} = models.FloatField(default=${c.eq || 0}, help_text='Constant: ${c.units || 'units'}')\n`;
    });
    block += `\n    class Meta:\n        verbose_name = '${obj.name}'\n\n`;
    return block;
  }

  let code = header;

  // Group by app
  apps.forEach(app => {
    const appObjs = getObjectsInApp(app.id);
    if (appObjs.length === 0) return;
    code += `# ─── App: ${app.name} ${'─'.repeat(Math.max(0, 40 - app.name.length))}\n\n`;
    appObjs.forEach(obj => { code += modelBlock(obj); });
  });

  // Standalone objects (no app)
  const standalone = objects.filter(o => !o.appId);
  if (standalone.length > 0) {
    if (apps.length > 0) code += `# ─── Standalone Models ${'─'.repeat(19)}\n\n`;
    standalone.forEach(obj => { code += modelBlock(obj); });
  }

  return code;
}

function generateAppsConfig() {
  if (apps.length === 0) {
    return '# No Django Apps defined.\n# Use the App tool to create app containers, then assign Objects to them.\n';
  }
  let code = '';
  apps.forEach(app => {
    const className = app.name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('') + 'Config';
    code += `# ${app.name}/apps.py\nfrom django.apps import AppConfig\n\nclass ${className}(AppConfig):\n    default_auto_field = 'django.db.models.BigAutoField'\n    name = '${app.name}'\n    verbose_name = '${app.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}'\n\n`;
  });
  code += `# settings.py — add to INSTALLED_APPS:\n# [\n`;
  apps.forEach(app => {
    code += `#     '${app.name}',\n`;
  });
  code += `# ]\n`;
  return code;
}

function generateViews() {
  const objNames = objects.map(o => o.name);

  // Build data dictionaries from the current diagram
  const stockNodes = nodes.filter(n => n.type === 'stock');
  const constNodes = nodes.filter(n => n.type === 'const');
  const auxNodes = nodes.filter(n => n.type === 'aux');
  const flowNodes = nodes.filter(n => n.type === 'flow');
  const flowEdges = edges.filter(e => e.type === 'flow');

  function pyDict(entries, indent = 4) {
    if (entries.length === 0) return '{}';
    const pad = ' '.repeat(indent);
    return '{\n' + entries.join('\n') + '\n}';
  }

  function pyEq(eq) {
    return (eq || '0').replace(/\^/g, '**');
  }

  // STOCKS dict
  const stockEntries = stockNodes.map(n => {
    const obj = objects.find(o => o.id === n.objectId);
    return `    '${n.name}': {'initial': ${parseFloat(n.eq) || 0}, 'units': '${n.units || ''}', 'object': '${obj?.name || ''}'},`;
  });

  // CONSTANTS dict
  const constEntries = constNodes.map(n => {
    const obj = objects.find(o => o.id === n.objectId);
    return `    '${n.name}': {'value': ${parseFloat(n.eq) || 0}, 'units': '${n.units || ''}', 'object': '${obj?.name || ''}'},`;
  });

  // AUXILIARIES dict
  const auxEntries = auxNodes.map(n =>
    `    '${n.name}': {'equation': '${pyEq(n.eq)}', 'units': '${n.units || ''}'},`
  );

  // FLOWS dict (flow nodes with their own equations)
  const flowEntries = flowNodes.map(n =>
    `    '${n.name}': {'equation': '${pyEq(n.eq)}', 'units': '${n.units || ''}'},`
  );

  // STOCK_FLOWS: for each stock, collect inflow/outflow edge equations
  const stockFlowMap = {};
  stockNodes.forEach(n => { stockFlowMap[n.name] = { inflows: [], outflows: [] }; });
  flowEdges.forEach(e => {
    const tgtNode = nodes.find(n => n.id === e.tgt);
    const srcNode = nodes.find(n => n.id === e.src);
    if (tgtNode && tgtNode.type === 'stock' && stockFlowMap[tgtNode.name]) {
      stockFlowMap[tgtNode.name].inflows.push(pyEq(e.eq));
    }
    if (srcNode && srcNode.type === 'stock' && stockFlowMap[srcNode.name]) {
      stockFlowMap[srcNode.name].outflows.push(pyEq(e.eq));
    }
  });
  const stockFlowEntries = Object.entries(stockFlowMap).map(([name, flows]) =>
    `    '${name}': {'inflows': [${flows.inflows.map(e => `'${e}'`).join(', ')}], 'outflows': [${flows.outflows.map(e => `'${e}'`).join(', ')}]},`
  );

  let code = `import json
import math
import re
from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .models import ${objNames.length ? objNames.join(', ') : 'SystemDynamicsBase'}


# ──────────────────────────────────────────────
# Model definitions extracted from SD Builder
# ──────────────────────────────────────────────

STOCKS = {
${stockEntries.join('\n')}
}

CONSTANTS = {
${constEntries.join('\n')}
}

AUXILIARIES = {
${auxEntries.join('\n')}
}

FLOWS = {
${flowEntries.join('\n')}
}

STOCK_FLOWS = {
${stockFlowEntries.join('\n')}
}


# ──────────────────────────────────────────────
# Expression evaluator
# ──────────────────────────────────────────────

SAFE_MATH = {
    '__builtins__': {},
    'abs': abs, 'min': min, 'max': max, 'round': round,
    'sqrt': math.sqrt, 'exp': math.exp, 'log': math.log,
    'log10': math.log10, 'pow': pow,
    'sin': math.sin, 'cos': math.cos, 'tan': math.tan,
    'asin': math.asin, 'acos': math.acos, 'atan': math.atan,
    'pi': math.pi, 'e': math.e,
    'ceil': math.ceil, 'floor': math.floor,
}


def safe_eval(expr, state):
    """Evaluate a math expression with variable substitution."""
    if not expr or not expr.strip():
        return 0.0
    e = expr.strip()
    # Replace variable names with their values (longest first to avoid partial matches)
    names = sorted(state.keys(), key=len, reverse=True)
    for name in names:
        e = re.sub(r'\\b' + re.escape(name) + r'\\b', str(float(state[name])), e)
    e = e.replace('^', '**')
    try:
        return float(eval(e, SAFE_MATH))
    except Exception:
        return 0.0


# ──────────────────────────────────────────────
# Simulation engine
# ──────────────────────────────────────────────

def compute_step(stock_state, constants):
    """Compute auxiliaries, flows, and stock derivatives for one timestep."""
    state = {**stock_state, **constants}

    # 1. Evaluate auxiliary variables
    for name, aux in AUXILIARIES.items():
        state[name] = safe_eval(aux['equation'], state)

    # 2. Evaluate flow-node equations
    for name, flow in FLOWS.items():
        state[name] = safe_eval(flow['equation'], state)

    # 3. Compute stock derivatives from flow-edge equations
    derivatives = {}
    for stock_name, connections in STOCK_FLOWS.items():
        inflow = sum(safe_eval(eq, state) for eq in connections['inflows'])
        outflow = sum(safe_eval(eq, state) for eq in connections['outflows'])
        derivatives[stock_name] = inflow - outflow

    for name in STOCKS:
        derivatives.setdefault(name, 0.0)

    return state, derivatives


def simulate(t_start=0, t_end=100, dt=0.25, method='euler', overrides=None):
    """
    Run the system dynamics simulation.

    Args:
        t_start: Start time.
        t_end:   End time.
        dt:      Timestep.
        method:  'euler' or 'rk4'.
        overrides: Dict of {variable_name: value} to override initial/constant values.

    Returns:
        Dict with 'times' and 'series' (variable name -> list of values).
    """
    constants = {name: c['value'] for name, c in CONSTANTS.items()}
    stock_state = {name: s['initial'] for name, s in STOCKS.items()}

    if overrides:
        for k, v in overrides.items():
            if k in stock_state:
                stock_state[k] = float(v)
            elif k in constants:
                constants[k] = float(v)

    tracked_names = list(STOCKS) + list(AUXILIARIES) + list(FLOWS)
    times = []
    series = {name: [] for name in tracked_names}

    t = t_start
    while t <= t_end + dt * 0.001:
        times.append(round(t, 10))
        state, derivatives = compute_step(stock_state, constants)

        for name in tracked_names:
            series[name].append(state.get(name, 0.0))

        if t >= t_end:
            break

        if method == 'rk4':
            k1 = derivatives
            mid1 = {n: stock_state[n] + k1[n] * dt / 2 for n in STOCKS}
            _, k2 = compute_step(mid1, constants)
            mid2 = {n: stock_state[n] + k2[n] * dt / 2 for n in STOCKS}
            _, k3 = compute_step(mid2, constants)
            end = {n: stock_state[n] + k3[n] * dt for n in STOCKS}
            _, k4 = compute_step(end, constants)
            for n in STOCKS:
                stock_state[n] += (k1[n] + 2 * k2[n] + 2 * k3[n] + k4[n]) * dt / 6
        else:
            for n in STOCKS:
                stock_state[n] += derivatives[n] * dt

        t += dt

    return {'times': times, 'series': series}


# ──────────────────────────────────────────────
# Django views
# ──────────────────────────────────────────────

@method_decorator(csrf_exempt, name='dispatch')
class SimulationView(View):
    """API endpoint for running system dynamics simulations."""

    def get(self, request):
        """Return model metadata: variables, units, and structure."""
        return JsonResponse({
            'stocks': STOCKS,
            'constants': CONSTANTS,
            'auxiliaries': AUXILIARIES,
            'flows': FLOWS,
            'stock_flows': {k: v for k, v in STOCK_FLOWS.items()},
        })

    def post(self, request):
        """
        Run simulation. Accepts JSON body:
        {
            "start": 0,
            "end": 100,
            "dt": 0.25,
            "method": "euler" | "rk4",
            "overrides": {"variable_name": value, ...}
        }
        """
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            data = {}

        try:
            results = simulate(
                t_start=float(data.get('start', 0)),
                t_end=float(data.get('end', 100)),
                dt=float(data.get('dt', 0.25)),
                method=data.get('method', 'euler'),
                overrides=data.get('overrides'),
            )
            return JsonResponse(results)
        except Exception as exc:
            return JsonResponse({'error': str(exc)}, status=400)


@method_decorator(csrf_exempt, name='dispatch')
class ModelMetaView(View):
    """Return the list of objects and their fields for the frontend."""

    def get(self, request):
        return JsonResponse({
            'objects': [
                {
                    'name': name,
                    'stocks': [s for s, v in STOCKS.items() if v.get('object') == name],
                    'constants': [c for c, v in CONSTANTS.items() if v.get('object') == name],
                }
                for name in sorted(set(
                    v.get('object', '') for v in list(STOCKS.values()) + list(CONSTANTS.values())
                ) - {''})
            ],
            'auxiliaries': list(AUXILIARIES.keys()),
            'flows': list(FLOWS.keys()),
        })
`;

  return code;
}

function generateUrls() {
  return `from django.urls import path
from .views import SimulationView, ModelMetaView

urlpatterns = [
    path('api/simulate/', SimulationView.as_view(), name='simulation'),
    path('api/model/', ModelMetaView.as_view(), name='model-meta'),
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
    { name: 'urls.py', content: generateUrls() },
    { name: 'apps.py', content: generateAppsConfig() }
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
    const obj = { id: objId, name: cls.name, x, y, w: OBJ_W, h: objH, appId: null };
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
    apps = [];
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
  const data = { apps, objects, nodes, edges, idCounter };
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
        apps = data.apps || [];
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
  const method = document.getElementById('sim-method').value;

  const constMap = {};
  nodes.filter(n => n.type === 'const').forEach(n => { constMap[n.name] = parseFloat(n.eq) || 0; });

  let stockState = {};
  stockNodes.forEach(n => { stockState[n.name] = parseFloat(n.eq) || 0; });

  const times = [];
  const series = {};
  const tracked = nodes.filter(n => n.type !== 'const');
  tracked.forEach(n => { series[n.name] = []; });

  // Compute a full state (aux + flow + derivatives) from a given stock state
  function computeStep(sState) {
    const state = { ...sState };
    nodes.filter(n => n.type === 'aux').forEach(n => {
      state[n.name] = evalExpr(n.eq, state, constMap);
    });
    nodes.filter(n => n.type === 'flow').forEach(n => {
      state[n.name] = evalExpr(n.eq, state, constMap);
    });
    const derivs = {};
    stockNodes.forEach(n => {
      const inflows = edges.filter(e => e.tgt === n.id && e.type === 'flow')
        .map(e => evalExpr(e.eq, state, constMap));
      const outflows = edges.filter(e => e.src === n.id && e.type === 'flow')
        .map(e => evalExpr(e.eq, state, constMap));
      derivs[n.name] = inflows.reduce((a, b) => a + b, 0) - outflows.reduce((a, b) => a + b, 0);
    });
    return { state, derivs };
  }

  let t = tStart;
  while (t <= tEnd + dt * 0.001) {
    times.push(t);
    const { state, derivs } = computeStep(stockState);
    tracked.forEach(n => { series[n.name].push(state[n.name] ?? 0); });

    if (t >= tEnd) break;

    if (method === 'rk4') {
      const k1 = derivs;
      const mid1 = {};
      stockNodes.forEach(n => { mid1[n.name] = stockState[n.name] + k1[n.name] * dt / 2; });
      const { derivs: k2 } = computeStep(mid1);
      const mid2 = {};
      stockNodes.forEach(n => { mid2[n.name] = stockState[n.name] + k2[n.name] * dt / 2; });
      const { derivs: k3 } = computeStep(mid2);
      const end = {};
      stockNodes.forEach(n => { end[n.name] = stockState[n.name] + k3[n.name] * dt; });
      const { derivs: k4 } = computeStep(end);
      stockNodes.forEach(n => {
        stockState[n.name] += (k1[n.name] + 2*k2[n.name] + 2*k3[n.name] + k4[n.name]) * dt / 6;
      });
    } else {
      stockNodes.forEach(n => { stockState[n.name] += derivs[n.name] * dt; });
    }
    t += dt;
  }
  
  simResults = { times, series, tracked };
  tracked.forEach(n => { if (!(n.name in visibleVars)) visibleVars[n.name] = n.type === 'stock'; });
  
  buildVarToggles(tracked);
  drawChart(times, series, tracked);
}

const SIM_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#06b6d4', '#eab308', '#ec4899'];

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
        x: { ticks: { maxTicksLimit: 8, font: { size: 10, family: "'Inter', system-ui, sans-serif" }, color: DARK ? '#71717a' : '#a1a1aa' }, grid: { color: DARK ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
        y: { ticks: { maxTicksLimit: 6, font: { size: 10, family: "'Inter', system-ui, sans-serif" }, color: DARK ? '#71717a' : '#a1a1aa' }, grid: { color: DARK ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } }
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
  apps = [{ id: 'a1', name: 'water_management', x: 60, y: 40, w: 320, h: 260 }];
  objects = [{ id: 'o1', name: 'WaterReservoir', x: 90, y: 80, w: 220, h: 180, appId: 'a1' }];
  nodes = [
    { id: 'n1', type: 'stock', name: 'volume', eq: '1000', units: 'm3', x: 200, y: 155, objectId: 'o1' },
    { id: 'n2', type: 'const', name: 'max_capacity', eq: '5000', units: 'm3', x: 200, y: 215, objectId: 'o1' },
    { id: 'n5', type: 'aux', name: 'rainfall_rate', eq: '50', units: 'm3/day', x: 490, y: 110, objectId: null },
    { id: 'n6', type: 'aux', name: 'demand_rate', eq: '30', units: 'm3/day', x: 490, y: 230, objectId: null }
  ];
  edges = [
    { id: 'e1', type: 'flow', src: 'n5', tgt: 'n1', eq: 'rainfall_rate', units: 'm3/day' },
    { id: 'e2', type: 'flow', src: 'n1', tgt: 'n6', eq: 'demand_rate', units: 'm3/day' }
  ];
  idCounter = 7;
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
