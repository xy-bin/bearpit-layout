/* 联盟熊坑布局规划 — 等距网格落位工具（v4：1坐标=1格，城镇2×2、旗子1格、熊坑3×3） */
'use strict';

/* ============ 常量 ============ */
const TILE_W = 78;
const TILE_H = 39;
const MAX_RINGS = 14;
const PIT_HALF = 1;          // 熊坑 3x3 = 9 格
const FONT = '"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif';
const MONO = 'Consolas,"JetBrains Mono",monospace';

const C = {
  emptyFill: 'rgba(14,30,40,0.88)',
  emptyStroke: 'rgba(58,140,160,0.26)',
  pitFill: '#f0c34a',
  pitStroke: '#ffe9a8',
  pitText: '#2a1c00',
  flagFill: 'rgba(88,58,160,0.45)',
  flagStroke: 'rgba(160,120,255,0.8)',
  flagText: '#d9caff',
  mineFill: 'rgba(220,60,60,0.38)',
  mineStroke: 'rgba(255,110,110,0.85)',
  mineText: '#ffd9d9',
  disFill: 'rgba(110,40,40,0.35)',
  disStroke: 'rgba(255,120,120,0.45)',
  disX: 'rgba(255,140,140,0.55)',
  hover: '#9fe8ff',
  select: '#ffffff',
  selEmpty: '#56c8e8',
  badTarget: 'rgba(255,120,120,0.9)',
  coordText: 'rgba(159,232,255,0.5)'
};

/* 布局分类：只用于颜色与图例 */
const CATS = {
  '地球': { fill: 'rgba(62,132,244,0.30)',  stroke: 'rgba(112,172,255,0.78)', text: '#cfe2ff', dot: '#3e84f4' },
  '陨石': { fill: 'rgba(236,188,62,0.30)',  stroke: 'rgba(255,216,110,0.80)', text: '#ffeec2', dot: '#ecbc3e' },
  '车身': { fill: 'rgba(56,200,112,0.30)',  stroke: 'rgba(108,236,160,0.78)', text: '#c9ffdc', dot: '#38c870' },
  '预留': { fill: 'rgba(70,90,105,0.30)',   stroke: 'rgba(120,150,170,0.5)',  text: '#aebfcc', dot: '#5c7484' }
};
const DEFAULT_CAT = '车身';

/* ============ 状态 ============ */
const state = {
  center: { x: 628, y: 523 },
  rings: 12,
  members: [],
  flags: [{ gx: 0, gy: -4 }],   // 联盟旗子（可多个）各占 1 格
  mines: [],                    // 联盟矿（可多个）各占 2×2，红色，不可放炉子
  disabled: new Set(),          // 禁用格 "gx,gy"
  hover: null,
  selectedId: null,
  selectedEmpty: null,          // 快速放置选中的 2×2 左上角
  selectedCell: null,           // 精确点中的单元格（旗子按此单格放置）
  queue: [],
  qCat: DEFAULT_CAT,
  eCat: DEFAULT_CAT,
  showCoords: false,
  watermark: '',                // 导出图片水印（空 = 不显示）
  zoom: 1,
  nextId: 1,
  filter: '',
  view: { tw: TILE_W, th: TILE_H, ox: 0, oy: 0, dpr: 1, w: 0, h: 0, fit: 1 }
};

const undoStack = [];
const redoStack = [];
let drag = null;
let pan = null;
let dragSnap = null;

/* ============ 工具函数 ============ */
const Core = window.BearCore;
const $ = (sel, root = document) => root.querySelector(sel);
const key = Core.key;
const cheb = Core.cheb;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const blockOffsets = [[0, 0], [1, 0], [0, 1], [1, 1]];
const blockTiles = (gx, gy) => [[gx, gy], [gx + 1, gy], [gx, gy + 1], [gx + 1, gy + 1]];

function inPit(gx, gy) { return Math.abs(gx) <= PIT_HALF && Math.abs(gy) <= PIT_HALF; }
function isFlag(gx, gy) { return state.flags.some(f => f.gx === gx && f.gy === gy); }
function isMine(gx, gy) {
  return state.mines.some(m => gx >= m.gx && gx <= m.gx + 1 && gy >= m.gy && gy <= m.gy + 1);
}

/** 设施占用：熊坑9格 + 旗子1格 + 联盟矿2×2 + 手动禁用 */
function facilityBlocked(tx, ty) {
  if (inPit(tx, ty)) return true;
  if (isFlag(tx, ty)) return true;
  if (isMine(tx, ty)) return true;
  return state.disabled.has(key(tx, ty));
}

function distToCenter(m) {
  if (m.x == null || m.y == null) return Infinity;
  return Math.hypot(m.x - state.center.x, m.y - state.center.y);
}

function blockedList() {
  const out = [];
  for (let dx = -PIT_HALF; dx <= PIT_HALF; dx++)
    for (let dy = -PIT_HALF; dy <= PIT_HALF; dy++)
      out.push(key(dx, dy));
  state.flags.forEach(f => out.push(key(f.gx, f.gy)));
  state.mines.forEach(m => blockTiles(m.gx, m.gy).forEach(t => out.push(key(t[0], t[1]))));
  state.disabled.forEach(k => out.push(k));
  return out;
}

/** 一个 2×2 座位能否放在 (gx,gy)（左上角）；exclude 为拖动中的成员本身 */
function blockFits(gx, gy, exclude) {
  for (const [tx, ty] of blockTiles(gx, gy)) {
    if (cheb(tx, ty) > state.rings) return false;
    if (facilityBlocked(tx, ty)) return false;
  }
  for (const m of state.members) {
    if (m === exclude || !m.seat) continue;
    if (Math.abs(m.seat.gx - gx) <= 1 && Math.abs(m.seat.gy - gy) <= 1) return false;
  }
  return true;
}

/** 单格能否放旗子：圈内、非熊坑、非其他旗、非矿、非禁用格、未被任何城镇 2×2 占用 */
function flagCellOk(gx, gy) {
  if (cheb(gx, gy) > state.rings) return false;
  if (facilityBlocked(gx, gy)) return false;
  return !memberAt(gx, gy);
}

/** 联盟矿 2×2 能否放在 (gx,gy)：圈内、不压熊坑/旗子/其他矿/禁用格/任何城镇 */
function mineFits(gx, gy) {
  for (const [tx, ty] of blockTiles(gx, gy)) {
    if (cheb(tx, ty) > state.rings) return false;
    if (inPit(tx, ty) || isFlag(tx, ty) || state.disabled.has(key(tx, ty))) return false;
    if (memberAt(tx, ty)) return false;
  }
  return !state.mines.some(m =>
    Math.abs(m.gx - gx) <= 1 && Math.abs(m.gy - gy) <= 1);
}

/* ===== 布局 CSV 的「距熊坑 / 圈层」口径（与模板文件一致） ===== */
/** 块（w=2 城镇 / w=1 旗子）与熊坑 3×3 的切比雪夫间距：0 = 紧贴熊坑 */
function gapToPit(gx, gy, w = 2) {
  const dx = Math.max(0, -PIT_HALF - (gx + w - 1), gx - PIT_HALF);
  const dy = Math.max(0, -PIT_HALF - (gy + w - 1), gy - PIT_HALF);
  return Math.max(dx, dy);
}
const layoutRingOf = gap => Math.ceil(gap / 2);

/** 点击某格后，吸附出包含该格的 2×2 放置位（左上角） */
function anchorFor(tile) {
  for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const gx = tile.gx + dx, gy = tile.gy + dy;
    if (blockFits(gx, gy, null)) return { gx, gy, ring: Math.round(Math.max(Math.abs(gx + 0.5), Math.abs(gy + 0.5))) };
  }
  return null;
}

/** 圈内不重叠的 2×2 座位集合（由内圈向外圈贪心选取） */
function buildIndependentSeats(rings) {
  const all = Core.buildBlocks(rings, blockedList());
  const taken = [], out = [];
  for (const s of all) {
    if (taken.some(t => Math.abs(t.gx - s.gx) <= 1 && Math.abs(t.gy - s.gy) <= 1)) continue;
    taken.push(s);
    out.push(s);
  }
  return out;
}

function autoRingsFor(count) {
  for (let r = 2; r <= MAX_RINGS; r++) {
    if (buildIndependentSeats(r).length >= count) return r;
  }
  return MAX_RINGS;
}

function autoLayout() {
  const seats = buildIndependentSeats(state.rings);
  const assigned = Core.assignSeats(state.members, seats, state.center);
  state.members.forEach((m, i) => { m.seat = assigned[i]; });
}

/** 设施/圈数变化后，清掉不再合法的 2×2 座位 */
function evictInvalidSeats() {
  for (const m of state.members) {
    if (m.seat && !blockFits(m.seat.gx, m.seat.gy, m)) m.seat = null;
  }
}

/* ============ 撤销 / 恢复 ============ */
function snapshot() {
  return JSON.stringify({
    center: state.center,
    rings: state.rings,
    flags: state.flags.map(f => ({ gx: f.gx, gy: f.gy })),
    mines: state.mines.map(m => ({ gx: m.gx, gy: m.gy })),
    disabled: [...state.disabled],
    members: state.members.map(m => ({
      name: m.name, x: m.x, y: m.y, flag: m.flag,
      cat: m.cat, note: m.note, seat: m.seat
    }))
  });
}

function restore(s) {
  const o = JSON.parse(s);
  state.center = o.center;
  state.rings = o.rings;
  state.flags = (o.flags && o.flags.length ? o.flags : (o.flagTile ? [o.flagTile] : []))
    .map(f => ({ gx: f.gx, gy: f.gy }));
  state.mines = (o.mines || []).map(m => ({ gx: m.gx, gy: m.gy }));
  state.disabled = new Set(o.disabled);
  state.members = o.members.map((m, i) => ({
    id: i + 1, name: m.name, x: m.x, y: m.y, flag: m.flag,
    cat: m.cat || DEFAULT_CAT, note: m.note || '', seat: m.seat
  }));
  state.nextId = state.members.length + 1;
  state.selectedId = null;
  state.selectedEmpty = null;
  state.selectedCell = null;
  $('#ringsSlider').value = state.rings;
  $('#ringsLabel').textContent = state.rings;
  $('#inCX').value = state.center.x;
  $('#inCY').value = state.center.y;
  renderAll();
}

function pushHistory(preSnap) {
  undoStack.push(preSnap || snapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}

/* ============ 本地自动保存（localStorage） ============ */
/* 任何改动后自动保存；下次打开页面自动恢复最新数据。存储不可用时静默降级。 */
const STORE_KEY = 'bearpit.layout.v1';

function persistNow() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      v: 1,
      ts: Date.now(),
      data: JSON.parse(snapshot()),
      showCoords: state.showCoords,
      watermark: state.watermark
    }));
  } catch (e) { /* 无痕模式 / 存储被禁用：忽略 */ }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persistNow(); if (window.kvSync) kvSync.push(); }, 250);
}

/* ============ 云端实时同步（Cloudflare KV，公开读 + 口令写） ============ */
const kvSync = window.makeKVSync ? window.makeKVSync({
  key: 'bearpit',
  debounceMs: 1200,
  pollMs: 30000,
  collect: () => ({
    v: 1,
    ts: Date.now(),
    data: JSON.parse(snapshot()),
    showCoords: state.showCoords,
    watermark: state.watermark
  }),
  apply: (payload) => {
    try {
      if (!payload || !payload.data || !Array.isArray(payload.data.members)) return;
      restore(JSON.stringify(payload.data));
      if (typeof payload.showCoords === 'boolean') {
        state.showCoords = payload.showCoords;
        $('#chkCoords').checked = payload.showCoords;
      }
      if (typeof payload.watermark === 'string') {
        state.watermark = payload.watermark;
        const wm = $('#inWatermark');
        if (wm) wm.value = payload.watermark;
      }
      undoStack.length = 0;
      redoStack.length = 0;
      renderStats();
      draw();
    } catch (e) { /* 云端数据损坏时忽略，保留当前画面 */ }
  },
  onStatus: (t) => { const el = $('#cloudStatus'); if (el) el.textContent = t ? '☁ ' + t : ''; },
  onLockExpired: () => { const b = $('#btnCloud'); if (b) b.textContent = '🔒 管理员'; }
}) : null;
window.kvSync = kvSync;

function setupCloudUI() {
  const btn = $('#btnCloud');
  if (!btn || !kvSync) { if (btn) btn.hidden = true; return; }
  btn.addEventListener('click', async () => {
    if (kvSync.isUnlocked()) {
      if (confirm('已解锁云端同步。要退出管理模式吗？（本机修改仍会保存，但不再上传云端）')) {
        window.KVStore.setPass('');
        btn.textContent = '🔒 管理员';
        $('#cloudStatus').textContent = '';
        renderDataVersion();
      }
      return;
    }
    const p = prompt('输入管理口令（修改将实时同步云端）');
    if (!p) return;
    btn.disabled = true;
    try {
      const ok = await kvSync.unlock(p);
      if (ok) {
        btn.textContent = '🔓 已解锁';
        kvSync.push(); /* 立即把当前内容推上云端 */
      } else alert('口令不正确');
    } catch (e) {
      alert(String(e.message || e));
    }
    btn.disabled = false;
  });
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.data || !Array.isArray(o.data.members)) return null;
    return o;
  } catch (e) { return null; }
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

/* ============ 示例数据 ============ */
const SAMPLE_NAMES = [
  'Aaron', 'Aren729', 'BKiss', '你萌到我', '戴爱吃熊', 'Milami', '不吃香菜', '深渊', '王十一', '空山闻雨',
  '蛰蛰苍龙', '绝对零度', '豚子', '蛋炒饭', '小少爷', '拾光', '微笑', '石夏', '飞飞', '南风知我意',
  '第三先生', '战神', '天罚', '小狼', '土士', '七星', '紫霞仙子', '冷月', '无双', '雪落',
  '大白白', '随风', '纸鸢', 'NoBug', '多啦A梦', '黑河', 'Aron', '将别', '斩月', '清幽',
  '阿里', '团团圆', '不怒', '阿呆', '北冥', '九幽', '小白', '影子', '暮光', '星野',
  '长安', '旧梦', '黑白', '清风', '晚风', '孤影', '归途', '烈火', '暗夜', '晨曦',
  '流年', '薄暮', '云深', '山海', '逐星', '听雨', '惊蛰', '寒江', '孤舟', '青山',
  '拾贰', '半盏', '微醺', '如初', '初见', '南栀', '北橙', '木木', '小鹿', '阿柚',
  '橘子', '柠檬', '布丁', '奶糖', '芝士', '麻薯', '团子', '汤圆', '饺子', '包子',
  '豆浆', '油条', '煎饼', '小笼', '烧卖', '春卷', '锅贴', '云吞', '小满', '白露'
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleRoster() {
  const rnd = mulberry32(20261103);
  const cats = Object.keys(CATS);
  return SAMPLE_NAMES.slice(0, 100).map((name, i) => ({
    name,
    x: state.center.x + Math.round(rnd() * 15 - 7),
    y: state.center.y + Math.round(rnd() * 15 - 7),
    flag: i % 5 === 0,
    cat: i % 9 === 0 ? cats[i % cats.length] : DEFAULT_CAT,
    note: ''
  }));
}

/* ============ 应用名单 ============ */
const parseRoster = text => Core.parseRoster(text);

function applyRoster(list, centerText, ringsText) {
  pushHistory();
  if (centerText) {
    const m = centerText.match(/(\d{3,4})\s*[,，\s]\s*(\d{3,4})/);
    if (m) state.center = { x: +m[1], y: +m[2] };
  }
  state.members = list.map(m => ({
    id: state.nextId++,
    name: m.name,
    x: m.x,
    y: m.y,
    flag: !!m.flag,
    cat: m.cat || DEFAULT_CAT,
    note: '',
    seat: null
  }));
  const r = parseInt(ringsText, 10);
  // 默认 12 圈；只有人数实在装不下时才按需增加（上限 MAX_RINGS）
  state.rings = (r >= 2 && r <= MAX_RINGS) ? r : Math.min(MAX_RINGS, Math.max(12, autoRingsFor(state.members.length)));
  $('#ringsSlider').value = state.rings;
  $('#ringsLabel').textContent = state.rings;
  $('#inCX').value = state.center.x;
  $('#inCY').value = state.center.y;
  autoLayout();
  renderAll();
}

/**
 * 按 CSV 精确落位：城镇按 2×2 左上角坐标、旗子按单格坐标；
 * 冲突/越界项标为待排，不覆盖已有成员
 */
function applyLayout(data, centerText, ringsText, opts = {}) {
  pushHistory();
  if (centerText) {
    const m = centerText.match(/(\d{3,4})\s*[,，\s]\s*(\d{3,4})/);
    if (m) state.center = { x: +m[1], y: +m[2] };
  }
  const cx = state.center.x, cy = state.center.y;

  // 先算需要多少圈
  let need = 0;
  for (const m of data.members) {
    const gx = m.x - cx, gy = m.y - cy;
    need = Math.max(need, cheb(gx, gy), cheb(gx + 1, gy + 1));
  }
  for (const f of data.flags) need = Math.max(need, cheb(f.x - cx, f.y - cy));
  for (const mn of (data.mines || [])) {
    need = Math.max(need, cheb(mn.x - cx, mn.y - cy), cheb(mn.x - cx + 1, mn.y - cy + 1));
  }
  const r = parseInt(ringsText, 10);
  state.rings = (r >= 2 && r <= MAX_RINGS) ? r : Math.min(MAX_RINGS, Math.max(12, need));

  state.members = [];
  state.flags = [];
  state.mines = [];
  state.disabled = new Set();

  // 联盟矿先落位（2×2，红色；城镇/旗子都不能压它）
  let mineSkip = 0;
  for (const mn of (data.mines || [])) {
    const gx = mn.x - cx, gy = mn.y - cy;
    if (!mineFits(gx, gy)) { mineSkip++; continue; }
    state.mines.push({ gx, gy });
  }

  // 旗子先落位（城镇不能覆盖旗子）
  let flagSkip = 0;
  for (const f of data.flags) {
    const gx = f.x - cx, gy = f.y - cy;
    if (cheb(gx, gy) > state.rings || inPit(gx, gy) || isFlag(gx, gy)) { flagSkip++; continue; }
    state.flags.push({ gx, gy });
  }

  let pending = 0;
  for (const m of data.members) {
    const gx = m.x - cx, gy = m.y - cy;
    const mem = {
      id: state.nextId++,
      name: m.name,
      x: m.x, y: m.y,
      flag: false,
      cat: CATS[m.cat] ? m.cat : DEFAULT_CAT,
      note: m.note || '',
      seat: null
    };
    if (blockFits(gx, gy, null)) {
      mem.seat = { gx, gy, ring: Math.round(Math.max(Math.abs(gx + 0.5), Math.abs(gy + 0.5))) };
    } else pending++;
    state.members.push(mem);
  }

  $('#ringsSlider').value = state.rings;
  $('#ringsLabel').textContent = state.rings;
  $('#inCX').value = cx;
  $('#inCY').value = cy;
  state.selectedId = null;
  state.selectedEmpty = null;
  state.selectedCell = null;
  renderAll();

  let msg = '导入完成：' + state.members.length + ' 个城镇、' + state.flags.length + ' 面联盟旗、' +
    state.mines.length + ' 处联盟矿，圈数 ' + state.rings + '。';
  if (pending) msg += '\n' + pending + ' 个城镇因超出圈数 / 重叠 / 压到熊坑、旗子或联盟矿，暂列「待排」。';
  if (flagSkip) msg += '\n' + flagSkip + ' 面旗子超出圈数或压在熊坑上，已跳过。';
  if (mineSkip) msg += '\n' + mineSkip + ' 处联盟矿位置无效（重叠/越界），已跳过。';
  if (!opts.silent) alert(msg);
}

/* ============ 视图 ============ */
function computeView() {
  const v = state.view;
  const needW = (2 * state.rings + 1) * TILE_W;
  const needH = (2 * state.rings + 1) * TILE_H;
  v.fit = Math.min((v.w - 50) / needW, (v.h - 40) / needH);
  v.tw = TILE_W * v.fit * state.zoom;
  v.th = TILE_H * v.fit * state.zoom;
}

function resize() {
  const wrap = $('#canvasWrap');
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cvs = $('#map');
  cvs.width = Math.max(1, Math.round(rect.width * dpr));
  cvs.height = Math.max(1, Math.round(rect.height * dpr));
  Object.assign(state.view, { w: rect.width, h: rect.height, dpr });
  computeView();
  if (state.zoom === 1) {
    state.view.ox = rect.width / 2;
    state.view.oy = rect.height / 2;
  } else {
    clampPan();
  }
  updateZoomUI();
  draw();
}

function clampPan() {
  const v = state.view;
  if (state.zoom <= 1) {
    v.ox = v.w / 2;
    v.oy = v.h / 2;
    return;
  }
  const halfW = (state.rings + 0.5) * v.tw;
  const halfH = (state.rings + 0.5) * v.th;
  const maxX = Math.max(0, halfW - v.w / 2 + 40);
  const maxY = Math.max(0, halfH - v.h / 2 + 40);
  v.ox = clamp(v.ox, v.w / 2 - maxX, v.w / 2 + maxX);
  v.oy = clamp(v.oy, v.h / 2 - maxY, v.h / 2 + maxY);
}

function zoomAt(mx, my, factor) {
  const nz = clamp(state.zoom * factor, 1, 3);
  if (nz === state.zoom) return;
  const v = state.view;
  const u = (mx - v.ox) / (v.tw / 2);
  const w = (v.oy - my) / (v.th / 2);
  state.zoom = nz;
  computeView();
  const v2 = state.view;
  v2.ox = mx - u * (v2.tw / 2);
  v2.oy = my + w * (v2.th / 2);
  clampPan();
  updateZoomUI();
  draw();
}

/** 缩放百分比标签 */
function updateZoomUI() {
  const el = $('#zoomLabel');
  if (el) el.textContent = Math.round(state.zoom * 100) + '%';
  const out = $('#btnZoomOut'), inn = $('#btnZoomIn'), rst = $('#btnZoomReset');
  if (out) out.disabled = state.zoom <= 1.001;
  if (inn) inn.disabled = state.zoom >= 2.999;
  if (rst) rst.disabled = state.zoom <= 1.001;
}

/** 以画布中心为锚点缩放 */
function zoomStep(factor) {
  const v = state.view;
  zoomAt(v.w / 2, v.h / 2, factor);
}

/** 恢复 100% 并居中 */
function zoomReset() {
  state.zoom = 1;
  computeView();
  state.view.ox = state.view.w / 2;
  state.view.oy = state.view.h / 2;
  updateZoomUI();
  draw();
}

/** 将成员的 2×2 块移到画布中央 */
function centerOn(seat) {
  state.zoom = Math.max(state.zoom, 1.6);
  computeView();
  const v = state.view;
  v.ox = v.w / 2 - (seat.gx - seat.gy) * v.tw / 2;
  v.oy = v.h / 2 + (seat.gx + seat.gy + 1) * v.th / 2;
  clampPan();
  updateZoomUI();
  draw();
}

/* ============ 渲染 ============ */
function diamondPath(ctx, cx, cy, hx, hy) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hy);
  ctx.lineTo(cx + hx, cy);
  ctx.lineTo(cx, cy + hy);
  ctx.lineTo(cx - hx, cy);
  ctx.closePath();
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function drawFlagIcon(ctx, sx, sy, tw, th, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, sy + th * 0.5);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + tw * 0.14, sy + th * 0.11);
  ctx.lineTo(sx, sy + th * 0.22);
  ctx.closePath();
  ctx.fill();
}

function tileCenter(gx, gy, v) {
  return {
    sx: v.ox + (gx - gy) * v.tw / 2,
    sy: v.oy - (gx + gy) * v.th / 2   // y 轴向上（与游戏/参考工具方向一致）
  };
}

function drawScene(ctx, v, opt = {}) {
  const { tw, th, ox, oy } = v;
  const rings = opt.rings != null ? opt.rings : state.rings;
  const showText = opt.text !== false;
  const showCoords = opt.coords === true ? true : (opt.coords === false ? false : state.showCoords);

  // 成员占用索引：格 -> 成员
  const occ = new Map();
  if (opt.members !== false) {
    for (const m of state.members) {
      if (!m.seat) continue;
      for (const [tx, ty] of blockTiles(m.seat.gx, m.seat.gy)) occ.set(key(tx, ty), m);
    }
  }

  /* --- 第一层：空格 / 禁用格（跳过被熊坑、成员覆盖的格） --- */
  for (let gx = -rings; gx <= rings; gx++) {
    for (let gy = -rings; gy <= rings; gy++) {
      if (cheb(gx, gy) > rings) continue;
      if (inPit(gx, gy) || occ.has(key(gx, gy))) continue;
      const { sx, sy } = tileCenter(gx, gy, v);
      const isDis = state.disabled.has(key(gx, gy));
      diamondPath(ctx, sx, sy, tw / 2, th / 2);
      ctx.fillStyle = isDis ? C.disFill : C.emptyFill;
      ctx.fill();
      const isHover = state.hover && state.hover.gx === gx && state.hover.gy === gy;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = isHover ? C.hover : (isDis ? C.disStroke : C.emptyStroke);
      ctx.lineWidth = isHover ? 1.6 : 1;
      ctx.stroke();
      if (isDis) {
        ctx.strokeStyle = C.disX;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(sx - tw * 0.16, sy);
        ctx.lineTo(sx + tw * 0.16, sy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx, sy - th * 0.3);
        ctx.lineTo(sx, sy + th * 0.3);
        ctx.stroke();
      }
    }
  }

  /* --- 第二层：熊坑 3×3（大菱形 hx=1.5tw, hy=1.5th） --- */
  diamondPath(ctx, ox, oy, tw * (PIT_HALF + 0.5), th * (PIT_HALF + 0.5));
  ctx.fillStyle = C.pitFill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.pitStroke;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  if (showText) {
    ctx.fillStyle = C.pitText;
    ctx.font = '700 ' + Math.round(th * 0.5) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('熊坑', ox, oy);
  }

  /* --- 第三层：成员城镇 2×2（大菱形 hx=tw, hy=th） --- */
  const hoverMember = state.hover && occ.get(key(state.hover.gx, state.hover.gy));
  for (const m of state.members) {
    if (!m.seat) continue;
    const sx = ox + (m.seat.gx - m.seat.gy) * tw / 2;
    const sy = oy - (m.seat.gx + m.seat.gy + 1) * th / 2;
    const cc = CATS[m.cat] || CATS[DEFAULT_CAT];
    diamondPath(ctx, sx, sy, tw, th);
    ctx.fillStyle = cc.fill;
    ctx.fill();

    const isSel = m.id === state.selectedId;
    const isDragSrc = drag && drag.mode === 'member' && drag.member === m;
    ctx.lineJoin = 'round';
    if (isDragSrc) {
      ctx.strokeStyle = C.hover;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (isSel || m === hoverMember) {
      ctx.strokeStyle = isSel ? C.select : C.hover;
      ctx.lineWidth = isSel ? 2 : 1.6;
      if (isSel) {
        ctx.shadowColor = 'rgba(62,198,192,0.9)';
        ctx.shadowBlur = 14;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = cc.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (!showText) continue;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cc.text;
    ctx.font = Math.round(th * 0.34) + 'px ' + FONT;
    ctx.fillText(fitText(ctx, m.name, tw * 1.5), sx, sy + th * 0.04);
    if (m.flag) drawFlagIcon(ctx, sx - tw * 0.72, sy - th * 0.42, tw * 0.9, th, 'rgba(196,166,255,0.95)');

    if (showCoords) {
      ctx.fillStyle = C.coordText;
      ctx.font = Math.round(th * 0.22) + 'px ' + MONO;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText((state.center.x + m.seat.gx) + ',' + (state.center.y + m.seat.gy), sx + tw * 0.78, sy + th * 0.72);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }
  }

  /* --- 第三层半：联盟矿 2×2（红色，不可放炉子） --- */
  for (const mine of state.mines) {
    const sx = ox + (mine.gx - mine.gy) * tw / 2;
    const sy = oy - (mine.gx + mine.gy + 1) * th / 2;
    diamondPath(ctx, sx, sy, tw, th);
    ctx.fillStyle = C.mineFill;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.mineStroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (showText) {
      ctx.fillStyle = C.mineText;
      ctx.font = 'bold ' + Math.round(th * 0.30) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('联盟矿', sx, sy);
    }
  }

  /* --- 第四层：联盟旗子（可多个，各占 1 格） --- */
  for (const f of state.flags) {
    const { sx, sy } = tileCenter(f.gx, f.gy, v);
    diamondPath(ctx, sx, sy, tw / 2, th / 2);
    ctx.fillStyle = C.flagFill;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.flagStroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (showText) {
      drawFlagIcon(ctx, sx - tw * 0.10, sy - th * 0.28, tw, th, C.flagText);
      ctx.fillStyle = C.flagText;
      ctx.font = Math.round(th * 0.24) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('旗子', sx - tw * 0.04, sy + th * 0.16);
    }
  }

  /* --- 第五层：选中的空位 / 拖拽目标预览 --- */
  const preview = drag && drag.mode === 'member' ? drag.target
    : (drag && drag.mode === 'mine' ? drag.target : state.selectedEmpty);
  if (preview) {
    const isMineDrag = drag && drag.mode === 'mine';
    const sx = ox + (preview.gx - preview.gy) * tw / 2;
    const sy = oy - (preview.gx + preview.gy + 1) * th / 2;
    const okFit = isMineDrag ? !!drag.valid
      : (drag && drag.mode === 'member'
        ? !!drag.valid
        : blockFits(preview.gx, preview.gy, null));
    diamondPath(ctx, sx, sy, tw, th);
    ctx.fillStyle = isMineDrag
      ? (okFit ? 'rgba(255,110,110,0.18)' : 'rgba(255,120,120,0.16)')
      : (okFit ? 'rgba(86,200,232,0.14)' : 'rgba(255,120,120,0.16)');
    ctx.fill();
    ctx.strokeStyle = okFit ? (isMineDrag ? C.mineStroke : C.selEmpty) : C.badTarget;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* --- 精确点中的单元格（放旗子用，1 格） --- */
  if (state.selectedCell && !drag) {
    const c = state.selectedCell;
    const okCell = flagCellOk(c.gx, c.gy);
    const { sx, sy } = tileCenter(c.gx, c.gy, v);
    diamondPath(ctx, sx, sy, tw / 2, th / 2);
    ctx.fillStyle = okCell ? 'rgba(196,166,255,0.26)' : 'rgba(255,120,120,0.22)';
    ctx.fill();
    ctx.strokeStyle = okCell ? 'rgba(196,166,255,0.95)' : C.badTarget;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function draw() {
  const cvs = $('#map');
  const ctx = cvs.getContext('2d');
  const { dpr, w, h } = state.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawScene(ctx, state.view);
}

/* ============ 命中检测 ============ */
function hitTest(clientX, clientY) {
  const cvs = $('#map');
  const rect = cvs.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const { tw, th, ox, oy } = state.view;
  const a = (x - ox) / (tw / 2);
  const b = (oy - y) / (th / 2);
  const gx = Math.round((a + b) / 2);
  const gy = Math.round((b - a) / 2);
  if (cheb(gx, gy) > state.rings) return null;
  return { gx, gy };
}

function memberAt(gx, gy) {
  for (const m of state.members) {
    if (!m.seat) continue;
    if (gx >= m.seat.gx && gx <= m.seat.gx + 1 && gy >= m.seat.gy && gy <= m.seat.gy + 1) return m;
  }
  return null;
}

/* ============ 统计 / 列表 ============ */
function renderStats() {
  const total = state.members.length;
  const placed = state.members.filter(m => m.seat).length;
  const flags = state.members.filter(m => m.flag).length;
  const waiting = total - placed;

  $('#stats').innerHTML =
    '熊坑中心 <b>' + state.center.x + ',' + state.center.y + '</b>' +
    '<span class="sep">·</span>圈数 <b>' + state.rings + '</b>' +
    '<span class="sep">·</span>已布置 <b>' + placed + '</b>' +
    '<span class="sep">·</span>待排 <b style="color:' + (waiting ? '#ff9a9a' : '#9fe8ff') + '">' + waiting + '</b>' +
    '<span class="sep">·</span>联盟旗 <b>' + state.flags.length + '</b>' +
    '<span class="sep">·</span>联盟矿 <b style="color:#ff9a9a">' + state.mines.length + '</b>' +
    '<span class="sep">·</span>旗标 <b>' + flags + '</b>';

  $('#canvasStats').innerHTML =
    '已布置 <b>' + placed + '</b> 人 · 联盟旗 <i>' + state.flags.length + '</i> · 联盟矿 <i>' + state.mines.length + '</i> · 待排 <span class="' +
    (waiting ? 'warn' : '') + '">' + waiting + ' 人</span>';

  $('#btnUndo').disabled = !undoStack.length;
  $('#btnRedo').disabled = !redoStack.length;
  scheduleSave();   // 任何数据变化都自动保存到本机
}

function sortedMembers() {
  return state.members.slice().sort((a, b) => {
    const ra = a.seat ? a.seat.ring : 99;
    const rb = b.seat ? b.seat.ring : 99;
    if (ra !== rb) return ra - rb;
    return distToCenter(a) - distToCenter(b);
  });
}

function renderPlacedList() {
  const kw = state.filter.trim().toLowerCase();
  const rows = sortedMembers().filter(m => !kw || m.name.toLowerCase().includes(kw));
  $('#placedCount').textContent = state.members.length + ' 人 · 待排 ' +
    (state.members.length - state.members.filter(m => m.seat).length);

  $('#placedList').innerHTML = rows.map(m => {
    const coord = m.seat
      ? (state.center.x + m.seat.gx) + ',' + (state.center.y + m.seat.gy)
      : (m.x == null ? '未排位' : m.x + ',' + m.y + '（待排）');
    const dot = (CATS[m.cat] || CATS[DEFAULT_CAT]).dot;
    return '<div class="prow' + (m.id === state.selectedId ? ' active' : '') + '" data-id="' + m.id + '">' +
      '<span class="cat-dot" style="background:' + dot + '"></span>' +
      (m.flag ? '<span style="color:#c4a6ff">⚑</span>' : '') +
      '<span class="pname">' + escapeHtml(m.name) + '</span>' +
      '<span class="pcoord">' + coord + '</span>' +
      '</div>';
  }).join('') || '<div class="card-desc" style="padding:12px 8px">没有匹配的成员</div>';
}

function renderQueue() {
  const box = $('#queueBox');
  if (!state.queue.length) {
    box.innerHTML = '待排队列（0）：加入后点击画布空位自动放置（每个成员占 2×2）';
    return;
  }
  box.innerHTML = '待排队列（' + state.queue.length + '）：<br>' +
    state.queue.map((n, i) =>
      '<span class="qchip" data-i="' + i + '">' + escapeHtml(n) + '<i>✕</i></span>'
    ).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderLegend() {
  const items = [
    { label: '熊坑(3×3·9格)', color: '#ffe9a8', bg: '#f0c34a' },
    { label: '联盟矿(2×2·不可放炉子)', color: 'rgba(255,110,110,0.9)', bg: 'rgba(220,60,60,0.4)' },
    { label: '联盟旗子(1格)', color: 'rgba(160,120,255,0.9)', bg: 'rgba(88,58,160,0.6)' },
    { label: '禁用格', color: 'rgba(255,120,120,0.6)', bg: 'rgba(110,40,40,0.4)' }
  ];
  for (const [name, cc] of Object.entries(CATS)) {
    items.push({ label: name + '(城镇2×2)', color: cc.stroke, bg: cc.fill });
  }
  $('#legend').innerHTML = items.map(it =>
    '<span class="item"><span class="swatch" style="border-color:' + it.color + ';background:' + it.bg + '"></span>' +
    it.label + '</span>'
  ).join('');
}

function renderAll() {
  renderStats();
  renderPlacedList();
  renderQueue();
  updateSelEmptyInfo();
  updateEditCard();
  resize();
}

/* ============ 快速放置 ============ */
function updateSelEmptyInfo() {
  const el = $('#selEmptyInfo');
  const s = state.selectedEmpty;
  const c = state.selectedCell;
  if (!s && !c) {
    el.textContent = '未选择空位：请在画布上点击一个空格（城镇需 2×2，旗子占 1 格）';
    el.classList.remove('ok');
    return;
  }
  const cCell = c ? (state.center.x + c.gx) + ',' + (state.center.y + c.gy) : '';
  let txt = '';
  if (c) {
    const cellOk = flagCellOk(c.gx, c.gy);
    txt = '点击单元格 ' + cCell + (cellOk ? '（可放旗子 1 格）' : '（不可放旗子）');
  }
  if (s) {
    txt += (txt ? '；' : '') + '城镇位 R' + s.ring + ' 左上格 ' +
      (state.center.x + s.gx) + ',' + (state.center.y + s.gy) + '（占 2×2=4 格）';
  } else if (c) {
    txt += '；该处放不下 2×2 城镇';
  }
  el.textContent = txt;
  el.classList.add('ok');
}

function placeAt(seat, name, cat, note, flag) {
  pushHistory();
  state.members.push({
    id: state.nextId++,
    name,
    x: null, y: null,
    flag: !!flag,
    cat: cat || DEFAULT_CAT,
    note: note || '',
    seat: { gx: seat.gx, gy: seat.gy, ring: cheb(seat.gx + 0.5, seat.gy + 0.5) }
  });
  renderAll();
}

/* ============ 成员编辑卡 ============ */
function updateEditCard() {
  const m = state.members.find(x => x.id === state.selectedId);
  const inputs = ['#eName', '#eX', '#eY', '#eNote'].map(s => $(s));
  const catBtns = $('#eCats').querySelectorAll('.chip-btn');
  const on = !!m;
  inputs.forEach(i => { i.disabled = !on; });
  catBtns.forEach(b => { b.disabled = !on; });
  $('#btnEditApply').disabled = !on;
  $('#btnEditDelete').disabled = !on;

  if (!on) {
    $('#eName').value = '';
    $('#eX').value = '';
    $('#eY').value = '';
    $('#eNote').value = '';
    $('#editHint').textContent = '点击地图中的成员格，可查看名称、分类、备注；也可修改座位目标坐标（左上格）。';
    return;
  }
  $('#eName').value = m.name;
  $('#eX').value = m.seat ? state.center.x + m.seat.gx : '';
  $('#eY').value = m.seat ? state.center.y + m.seat.gy : '';
  $('#eNote').value = m.note || '';
  $('#editHint').textContent = '正在编辑：' + m.name +
    (m.seat ? ' · R' + m.seat.ring + ' · 左上格 ' + (state.center.x + m.seat.gx) + ',' + (state.center.y + m.seat.gy) + '（2×2）' : ' · 未排位');
  catBtns.forEach(b => b.classList.toggle('active', b.dataset.cat === (m.cat || DEFAULT_CAT)));
}

function applyEdit() {
  const m = state.members.find(x => x.id === state.selectedId);
  if (!m) return;
  const name = $('#eName').value.trim();
  if (!name) { alert('游戏名不能为空'); return; }

  let newSeat = m.seat;
  if ($('#eX').value !== '' && $('#eY').value !== '') {
    const x = parseInt($('#eX').value, 10);
    const y = parseInt($('#eY').value, 10);
    if (!(x >= 1 && x <= 9999 && y >= 1 && y <= 9999)) {
      alert('目标坐标无效（1-9999）');
      return;
    }
    const gx = x - state.center.x;
    const gy = y - state.center.y;
    if (!blockFits(gx, gy, m)) {
      alert('目标位置放不下 2×2 城镇（超圈 / 熊坑旗子禁用格 / 与他人重叠）');
      return;
    }
    newSeat = { gx, gy, ring: Math.round(Math.max(Math.abs(gx + 0.5), Math.abs(gy + 0.5))) };
  }

  pushHistory();
  m.name = name;
  m.cat = state.eCat;
  m.note = $('#eNote').value.trim();
  m.seat = newSeat;
  renderAll();
}

function deleteSelected() {
  const m = state.members.find(x => x.id === state.selectedId);
  if (!m) return;
  pushHistory();
  state.members = state.members.filter(x => x !== m);
  state.selectedId = null;
  renderAll();
}

/* ============ 事件 ============ */
function setupEvents() {
  const cvs = $('#map');
  const tip = $('#tip');

  /* --- 移动 / 悬停 --- */
  cvs.addEventListener('mousemove', e => {
    const hit = hitTest(e.clientX, e.clientY);

    if (pan) {
      state.view.ox = pan.ox + (e.clientX - pan.mx);
      state.view.oy = pan.oy + (e.clientY - pan.my);
      clampPan();
      draw();
      return;
    }

    if (drag) {
      if (drag.mode === 'flag' && hit) {
        const f = state.flags[drag.idx];
        if (f && (hit.gx !== f.gx || hit.gy !== f.gy)) {
          // 旗帜只能落在：圈内、非熊坑、非其他旗、非禁用格、且未被任何城镇(2×2)占用
          if (cheb(hit.gx, hit.gy) <= state.rings && !facilityBlocked(hit.gx, hit.gy) && !memberAt(hit.gx, hit.gy)) {
            f.gx = hit.gx; f.gy = hit.gy;
          }
        }
      } else if (drag.mode === 'mine' && hit) {
        const mine = state.mines[drag.idx];
        if (mine) {
          const T = { gx: hit.gx - drag.grab.dx, gy: hit.gy - drag.grab.dy };
          drag.target = T;
          drag.valid = mineFits(T.gx, T.gy) ||
            (T.gx === mine.gx && T.gy === mine.gy);
        }
      } else if (drag.mode === 'member') {
        drag.cur = hit;
        if (hit) {
          const T = { gx: hit.gx - drag.grab.dx, gy: hit.gy - drag.grab.dy };
          drag.target = T;
          drag.valid = blockFits(T.gx, T.gy, drag.member);
        } else {
          drag.target = null;
          drag.valid = false;
        }
      }
      state.hover = hit;
      draw();
      return;
    }

    const same = (state.hover && hit && state.hover.gx === hit.gx && state.hover.gy === hit.gy) ||
                 (!state.hover && !hit);
    if (!same) { state.hover = hit; draw(); }

    if (!hit) { tip.hidden = true; return; }
    const member = memberAt(hit.gx, hit.gy);
    const blocked = facilityBlocked(hit.gx, hit.gy);

    if (!member && !blocked) { tip.hidden = true; return; }
    let title = '', sub = '';
    if (inPit(hit.gx, hit.gy)) {
      title = '熊坑'; sub = '中心 ' + state.center.x + ',' + state.center.y + ' · 占 3×3=9 格';
    } else if (isMine(hit.gx, hit.gy)) {
      title = '联盟矿'; sub = '红色标记 · 占 2×2=4 格 · 不可放炉子 · 可拖动 · 右键删除';
    } else if (isFlag(hit.gx, hit.gy)) {
      title = '联盟旗子'; sub = '拖动换位 · 右键删除 · 占 1 格';
    } else if (member) {
      title = member.name + (member.flag ? ' ⚑' : '');
      sub = (member.cat || DEFAULT_CAT) + ' · R' + member.seat.ring + ' · 左上格 ' +
            (state.center.x + member.seat.gx) + ',' + (state.center.y + member.seat.gy) + ' · 占 2×2=4 格';
    }
    tip.innerHTML = '<div class="t-name">' + escapeHtml(title) + '</div><div class="t-sub">' + escapeHtml(sub) + '</div>';
    tip.hidden = false;
    const wrapRect = $('#canvasWrap').getBoundingClientRect();
    const tw = tip.offsetWidth, thh = tip.offsetHeight;
    let lx = e.clientX - wrapRect.left + 14;
    let ly = e.clientY - wrapRect.top + 16;
    if (lx + tw > wrapRect.width - 8) lx = e.clientX - wrapRect.left - tw - 10;
    if (ly + thh > wrapRect.height - 8) ly = e.clientY - wrapRect.top - thh - 10;
    tip.style.left = lx + 'px';
    tip.style.top = ly + 'px';
  });

  cvs.addEventListener('mouseleave', () => {
    if (pan || drag) return;
    state.hover = null;
    tip.hidden = true;
    draw();
  });

  /* --- 按下 --- */
  cvs.addEventListener('mousedown', e => {
    const hit = hitTest(e.clientX, e.clientY);

    if (e.button === 1) {
      pan = { mx: e.clientX, my: e.clientY, ox: state.view.ox, oy: state.view.oy };
      cvs.classList.add('panning');
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || !hit) return;

    const fi = state.flags.findIndex(f => f.gx === hit.gx && f.gy === hit.gy);
    if (fi >= 0) {
      drag = { mode: 'flag', idx: fi };
      dragSnap = snapshot();
      return;
    }
    const mi = state.mines.findIndex(m => hit.gx >= m.gx && hit.gx <= m.gx + 1 && hit.gy >= m.gy && hit.gy <= m.gy + 1);
    if (mi >= 0) {
      drag = {
        mode: 'mine',
        idx: mi,
        grab: { dx: clamp(hit.gx - state.mines[mi].gx, 0, 1), dy: clamp(hit.gy - state.mines[mi].gy, 0, 1) },
        target: null, valid: false
      };
      dragSnap = snapshot();
      return;
    }
    const member = memberAt(hit.gx, hit.gy);
    if (member) {
      drag = {
        mode: 'member',
        member,
        from: { ...member.seat },
        grab: { dx: hit.gx - member.seat.gx, dy: hit.gy - member.seat.gy },
        cur: null, target: null, valid: false
      };
      dragSnap = snapshot();
      return;
    }
    drag = { mode: 'empty', hit };
  });

  /* --- 抬起 --- */
  window.addEventListener('mouseup', () => {
    if (pan) {
      pan = null;
      cvs.classList.remove('panning');
      return;
    }
    if (!drag) return;
    const d = drag;
    drag = null;

    if (d.mode === 'flag') {
      if (snapshot() !== dragSnap) { undoStack.push(dragSnap); redoStack.length = 0; }
      dragSnap = null;
      draw(); renderStats();
      return;
    }

    if (d.mode === 'mine') {
      const mine = state.mines[d.idx];
      const T = d.target;
      if (mine && T && d.valid && (T.gx !== mine.gx || T.gy !== mine.gy)) {
        undoStack.push(dragSnap);
        redoStack.length = 0;
        mine.gx = T.gx; mine.gy = T.gy;
        evictInvalidSeats();
      }
      dragSnap = null;
      draw(); renderAll();
      return;
    }

    if (d.mode === 'member') {
      const T = d.target;
      const moved = T && d.valid && (T.gx !== d.from.gx || T.gy !== d.from.gy);
      if (moved) {
        // 与其他成员重叠 → 尝试交换
        const others = state.members.filter(m =>
          m !== d.member && m.seat &&
          Math.abs(m.seat.gx - T.gx) <= 1 && Math.abs(m.seat.gy - T.gy) <= 1);
        let done = false;
        if (others.length === 0) {
          pushHistory(dragSnap);
          d.member.seat = { gx: T.gx, gy: T.gy, ring: Math.round(Math.max(Math.abs(T.gx + 0.5), Math.abs(T.gy + 0.5))) };
          done = true;
        } else if (others.length === 1) {
          const B = others[0];
          const F = d.from;
          const disjoint = Math.abs(T.gx - F.gx) >= 2 || Math.abs(T.gy - F.gy) >= 2;
          const bOverlapOther = state.members.some(m =>
            m !== d.member && m !== B && m.seat &&
            Math.abs(m.seat.gx - F.gx) <= 1 && Math.abs(m.seat.gy - F.gy) <= 1);
          if (disjoint && !bOverlapOther) {
            pushHistory(dragSnap);
            d.member.seat = { gx: T.gx, gy: T.gy, ring: Math.round(Math.max(Math.abs(T.gx + 0.5), Math.abs(T.gy + 0.5))) };
            B.seat = { gx: F.gx, gy: F.gy, ring: F.ring };
            done = true;
          }
        }
        if (!done) { /* 位置无效，保持原位 */ }
      } else {
        state.selectedId = state.selectedId === d.member.id ? null : d.member.id;
      }
      dragSnap = null;
      draw(); renderAll();
      return;
    }

    if (d.mode === 'empty' && d.hit) {
      if (facilityBlocked(d.hit.gx, d.hit.gy)) return;

      // 待排队列非空 → 自动放置下一个
      if (state.queue.length) {
        const anchor = anchorFor(d.hit);
        if (!anchor) return;
        let name = state.queue.shift();
        let flag = false;
        if (/^[★☆*]/.test(name)) { flag = true; name = name.replace(/^[★☆*]+\s*/, ''); }
        name = name.trim();
        if (name) placeAt(anchor, name, state.qCat, '', flag);
        renderQueue();
        return;
      }

      // 普通点击 → 记录精确单元格（旗子）与吸附的 2×2 城镇位
      state.selectedCell = { gx: d.hit.gx, gy: d.hit.gy };
      state.selectedEmpty = anchorFor(d.hit);
      updateSelEmptyInfo();
      draw();
      // 触屏后短时间内不自动聚焦（避免页面滚动打断双击/连续点选，也避免频繁弹键盘）
      if (state.selectedEmpty && Date.now() - lastTouchAt > 600) $('#qName').focus();
    }
  });
  let lastTouchAt = 0;

  /* --- 右键 --- */
  cvs.addEventListener('contextmenu', e => {
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    const member = memberAt(hit.gx, hit.gy);

    if (member) {
      pushHistory();
      state.members = state.members.filter(m => m !== member);
      if (state.selectedId === member.id) state.selectedId = null;
      renderAll();
      return;
    }

    // 右键旗子 → 删除该旗（可加多面旗，也可随时删）
    const fi = state.flags.findIndex(f => f.gx === hit.gx && f.gy === hit.gy);
    if (fi >= 0) {
      pushHistory();
      state.flags.splice(fi, 1);
      renderAll();
      return;
    }

    // 右键联盟矿 → 删除该矿
    const mi = state.mines.findIndex(m => hit.gx >= m.gx && hit.gx <= m.gx + 1 && hit.gy >= m.gy && hit.gy <= m.gy + 1);
    if (mi >= 0) {
      pushHistory();
      state.mines.splice(mi, 1);
      renderAll();
      return;
    }

    if (e.shiftKey && !facilityBlocked(hit.gx, hit.gy)) {
      pushHistory();
      const k = key(hit.gx, hit.gy);
      if (state.disabled.has(k)) state.disabled.delete(k);
      else state.disabled.add(k);
      evictInvalidSeats();
      renderAll();
    }
  });

  /* --- Ctrl+滚轮缩放 --- */
  cvs.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = cvs.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  /* --- 双击空白 → 原地添加炉子（默认车身，可输入名称） --- */
  cvs.addEventListener('dblclick', e => {
    if (!$('#inlineName').hidden) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    if (memberAt(hit.gx, hit.gy) || facilityBlocked(hit.gx, hit.gy)) return;
    const anchor = anchorFor(hit);
    if (!anchor) { alert('该处放不下 2×2 城镇（炉子）'); return; }
    const wrap = $('#canvasWrap');
    const rect = wrap.getBoundingClientRect();
    const inp = $('#inlineName');
    inp.value = '';
    inp.dataset.gx = anchor.gx;
    inp.dataset.gy = anchor.gy;
    inp.style.left = (e.clientX - rect.left) + 'px';
    inp.style.top = (e.clientY - rect.top) + 'px';
    inp.hidden = false;
    inp.focus();
  });

  /* 回车 / 失焦 → 确认放置；Esc → 取消 */
  function commitInline(cancel) {
    const inp = $('#inlineName');
    if (inp.hidden) return;
    const gx = +inp.dataset.gx, gy = +inp.dataset.gy;
    const name = inp.value.trim();
    inp.hidden = true;
    if (cancel) return;
    placeAt({ gx, gy }, name || ('城镇' + state.nextId), DEFAULT_CAT, '', false);
    state.selectedEmpty = null;
    state.selectedCell = null;
    updateSelEmptyInfo();
    renderAll();
  }
  $('#inlineName').addEventListener('keydown', e => {
    if (e.key === 'Enter') commitInline(false);
    else if (e.key === 'Escape') commitInline(true);
  });
  $('#inlineName').addEventListener('blur', () => commitInline(false));

  /* --- 长按菜单（触屏端替代右键） --- */
  const ctxMenu = $('#ctxMenu');
  function hideCtxMenu() { if (ctxMenu) ctxMenu.hidden = true; }
  function openCtxMenu(hit, cx, cy) {
    if (!ctxMenu || !hit) return;
    const items = [];
    const member = memberAt(hit.gx, hit.gy);
    if (member) {
      items.push(['删除成员「' + member.name + '」', () => {
        pushHistory();
        state.members = state.members.filter(m => m !== member);
        if (state.selectedId === member.id) state.selectedId = null;
        renderAll();
      }]);
    }
    const fi = state.flags.findIndex(f => f.gx === hit.gx && f.gy === hit.gy);
    if (fi >= 0) {
      items.push(['删除联盟旗子', () => { pushHistory(); state.flags.splice(fi, 1); renderAll(); }]);
    }
    const mi = state.mines.findIndex(m => hit.gx >= m.gx && hit.gx <= m.gx + 1 && hit.gy >= m.gy && hit.gy <= m.gy + 1);
    if (mi >= 0) {
      items.push(['删除联盟矿', () => { pushHistory(); state.mines.splice(mi, 1); renderAll(); }]);
    }
    if (!member && fi < 0 && mi < 0 && !inPit(hit.gx, hit.gy)) {
      const dis = state.disabled.has(key(hit.gx, hit.gy));
      items.push([dis ? '取消禁用格' : '标记禁用格', () => {
        pushHistory();
        if (dis) state.disabled.delete(key(hit.gx, hit.gy));
        else state.disabled.add(key(hit.gx, hit.gy));
        evictInvalidSeats();
        renderAll();
      }]);
    }
    if (!items.length) return;
    items.push(['取消', () => {}]);
    ctxMenu.innerHTML = '';
    items.forEach(([label, fn], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (i === items.length - 1) b.className = 'cancel';
      b.addEventListener('click', () => { hideCtxMenu(); fn(); });
      ctxMenu.appendChild(b);
    });
    const rect = $('#canvasWrap').getBoundingClientRect();
    ctxMenu.hidden = false;
    const lx = clamp(cx - rect.left, 8, rect.width - ctxMenu.offsetWidth - 8);
    const ly = clamp(cy - rect.top, 8, rect.height - ctxMenu.offsetHeight - 8);
    ctxMenu.style.left = lx + 'px';
    ctxMenu.style.top = ly + 'px';
  }

  /* --- 触屏手势：拖动成员/旗子/矿 · 拖空白平移 · 双指捏合缩放 · 长按菜单 · 双击加炉子 --- */
  if (typeof TouchEvent !== 'undefined') {
    let t = null;          // 单指状态
    let pinch = null;      // 双指状态
    let longTimer = null;
    let longFired = false;
    let lastTap = 0, lastTapX = 0, lastTapY = 0;
    const d2 = (x1, y1, x2, y2) => (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    const asMouse = (type, x, y) => new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
    const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } };
    const cancelAll = () => {
      clearLong();
      if (drag) { drag = null; dragSnap = null; }
      if (pan) { pan = null; cvs.classList.remove('panning'); }
      pinch = null; t = null;
      draw();
    };

    cvs.addEventListener('touchstart', e => {
      hideCtxMenu();
      if (e.touches.length >= 2) {
        cancelAll();
        const [a, b] = e.touches;
        pinch = {
          d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2
        };
        e.preventDefault();
        return;
      }
      const p = e.touches[0];
      lastTouchAt = Date.now();
      const hit = hitTest(p.clientX, p.clientY);
      longFired = false;
      t = { sx: p.clientX, sy: p.clientY, lx: p.clientX, ly: p.clientY, moved: false, mode: 'pan', emptyHit: null };
      if (hit) {
        const isMineHit = state.mines.some(m => hit.gx >= m.gx && hit.gx <= m.gx + 1 && hit.gy >= m.gy && hit.gy <= m.gy + 1);
        const isFlagHit = state.flags.some(f => f.gx === hit.gx && f.gy === hit.gy);
        if (isFlagHit || isMineHit || memberAt(hit.gx, hit.gy)) {
          cvs.dispatchEvent(asMouse('mousedown', p.clientX, p.clientY));
          t.mode = 'drag';
          longTimer = setTimeout(() => {
            longFired = true;
            if (drag) { drag = null; dragSnap = null; draw(); }
            openCtxMenu(hit, p.clientX, p.clientY);
          }, 550);
        } else {
          t.mode = 'empty';
          t.emptyHit = hit;
          // 长按空格 → 菜单（标记 / 取消禁用格）
          longTimer = setTimeout(() => {
            longFired = true;
            openCtxMenu(hit, p.clientX, p.clientY);
          }, 550);
        }
      }
      e.preventDefault();
    }, { passive: false });

    cvs.addEventListener('touchmove', e => {
      if (e.touches.length >= 2) {
        if (pinch) {
          const [a, b] = e.touches;
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
          if (d > 0 && pinch.d > 0) {
            state.view.ox += mx - pinch.mx;
            state.view.oy += my - pinch.my;
            const rect = cvs.getBoundingClientRect();
            zoomAt(mx - rect.left, my - rect.top, d / pinch.d);
          }
          pinch.d = d; pinch.mx = mx; pinch.my = my;
        }
        e.preventDefault();
        return;
      }
      if (!t) return;
      const p = e.touches[0];
      if (!t.moved && d2(p.clientX, p.clientY, t.sx, t.sy) > 144) {
        t.moved = true;
        clearLong();
        if (t.mode === 'empty') {
          // 空白处拖动 → 平移地图
          pan = { mx: t.lx, my: t.ly, ox: state.view.ox, oy: state.view.oy };
          cvs.classList.add('panning');
          t.mode = 'pan';
        }
      }
      if (t.moved) cvs.dispatchEvent(asMouse('mousemove', p.clientX, p.clientY));
      t.lx = p.clientX; t.ly = p.clientY;
      e.preventDefault();
    }, { passive: false });

    cvs.addEventListener('touchend', e => {
      clearLong();
      if (pinch) {
        if (e.touches.length < 2) pinch = null;
        e.preventDefault();
        return;
      }
      if (!t) return;
      const p = e.changedTouches[0];
      const wasLong = longFired;
      longFired = false;
      const mode = t.mode, moved = t.moved, emptyHit = t.emptyHit;
      t = null;
      if (wasLong) {
        if (drag) { drag = null; dragSnap = null; draw(); }
        e.preventDefault();
        return;
      }
      if (mode === 'drag' || mode === 'pan') {
        window.dispatchEvent(asMouse('mouseup', p.clientX, p.clientY));
      } else if (mode === 'empty' && !moved && emptyHit) {
        const now = Date.now();
        if (now - lastTap < 400 && d2(p.clientX, p.clientY, lastTapX, lastTapY) < 900) {
          // 双击空白 → 内联输入加炉子
          lastTap = 0;
          cvs.dispatchEvent(asMouse('dblclick', p.clientX, p.clientY));
        } else {
          lastTap = now; lastTapX = p.clientX; lastTapY = p.clientY;
          drag = { mode: 'empty', hit: emptyHit };
          window.dispatchEvent(asMouse('mouseup', p.clientX, p.clientY));
        }
      }
      e.preventDefault();
    }, { passive: false });

    cvs.addEventListener('touchcancel', cancelAll);
    window.addEventListener('touchstart', e => {
      if (!ctxMenu || ctxMenu.hidden) return;
      if (!ctxMenu.contains(e.target)) hideCtxMenu();
    }, true);
  }

  /* --- 快速放置 --- */
  $('#qCats').addEventListener('click', e => {
    const btn = e.target.closest('.chip-btn');
    if (!btn) return;
    state.qCat = btn.dataset.cat;
    $('#qCats').querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('active', b === btn));
  });

  $('#qName').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#btnPlace').click();
  });

  $('#btnPlace').addEventListener('click', () => {
    const name = $('#qName').value.trim();
    if (!state.selectedEmpty) { alert('请先在画布上点击一个空格'); return; }
    if (!blockFits(state.selectedEmpty.gx, state.selectedEmpty.gy, null)) {
      alert('该位置已不可用，请重新选择空位');
      state.selectedEmpty = null;
      updateSelEmptyInfo();
      draw();
      return;
    }
    if (!name) { alert('请填写游戏名'); return; }
    placeAt(state.selectedEmpty, name, state.qCat, $('#qNote').value.trim(), false);
    $('#qName').value = '';
    $('#qNote').value = '';
    state.selectedEmpty = null;
    state.selectedCell = null;
    updateSelEmptyInfo();
  });

  $('#btnFlag').addEventListener('click', () => {
    const t = state.selectedCell || state.selectedEmpty;
    if (!t) { alert('请先在画布上点击一个空白格'); return; }
    if (cheb(t.gx, t.gy) > state.rings || inPit(t.gx, t.gy)) {
      alert('该位置不可放置旗子');
      return;
    }
    if (isFlag(t.gx, t.gy)) { alert('该格已有旗子，不能重复放置'); return; }
    if (memberAt(t.gx, t.gy)) { alert('旗帜不能覆盖城镇（炉子 2×2），请选择完全空白的格子'); return; }
    if (state.disabled.has(key(t.gx, t.gy))) { alert('该格已标记为禁用，不能放置旗子'); return; }
    pushHistory();
    state.flags.push({ gx: t.gx, gy: t.gy });
    state.selectedEmpty = null;
    state.selectedCell = null;
    updateSelEmptyInfo();
    renderAll();
  });

  $('#btnMine').addEventListener('click', () => {
    const t = state.selectedEmpty;
    if (!t) { alert('请先在画布上点击一个空格（联盟矿需要 2×2 空位）'); return; }
    if (!mineFits(t.gx, t.gy)) {
      alert('该位置放不下联盟矿（2×2）：需圈内空白，且不与城镇/旗子/其他矿/熊坑/禁用格重叠');
      return;
    }
    pushHistory();
    state.mines.push({ gx: t.gx, gy: t.gy });
    state.selectedEmpty = null;
    state.selectedCell = null;
    updateSelEmptyInfo();
    renderAll();
  });

  /* --- 批量连续排位 --- */
  $('#btnEnqueue').addEventListener('click', () => {
    const lines = $('#batchText').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) { alert('请先在文本框里输入游戏名（每行一个）'); return; }
    state.queue.push(...lines);
    $('#batchText').value = '';
    renderQueue();
  });

  $('#queueBox').addEventListener('click', e => {
    const chip = e.target.closest('.qchip');
    if (!chip) return;
    state.queue.splice(+chip.dataset.i, 1);
    renderQueue();
  });

  $('#btnCompact').addEventListener('click', () => {
    pushHistory();
    autoLayout();
    state.selectedId = null;
    state.selectedEmpty = null;
    state.selectedCell = null;
    renderAll();
  });

  /* --- 成员编辑 --- */
  $('#eCats').addEventListener('click', e => {
    const btn = e.target.closest('.chip-btn');
    if (!btn || btn.disabled) return;
    state.eCat = btn.dataset.cat;
    $('#eCats').querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('active', b === btn));
  });

  $('#btnEditApply').addEventListener('click', applyEdit);
  $('#btnEditDelete').addEventListener('click', deleteSelected);

  /* --- 已排成员 --- */
  $('#search').addEventListener('input', e => {
    state.filter = e.target.value;
    renderPlacedList();
  });

  $('#placedList').addEventListener('click', e => {
    const row = e.target.closest('.prow');
    if (!row) return;
    state.selectedId = state.selectedId === +row.dataset.id ? null : +row.dataset.id;
    draw();
    renderPlacedList();
    updateEditCard();
  });

  $('#placedList').addEventListener('dblclick', e => {
    const row = e.target.closest('.prow');
    if (!row) return;
    const m = state.members.find(x => x.id === +row.dataset.id);
    if (m && m.seat) {
      state.selectedId = m.id;
      centerOn(m.seat);
      renderPlacedList();
      updateEditCard();
    }
  });

  /* --- 工具栏 --- */
  $('#btnZoomIn').addEventListener('click', () => zoomStep(1.25));
  $('#btnZoomOut').addEventListener('click', () => zoomStep(1 / 1.25));
  $('#btnZoomReset').addEventListener('click', zoomReset);
  $('#zoomLabel').addEventListener('click', zoomReset);
  $('#zoomLabel').title = '点击恢复 100% 并居中';

  $('#ringsSlider').addEventListener('input', e => {
    $('#ringsLabel').textContent = e.target.value;
  });
  $('#ringsSlider').addEventListener('change', e => {
    const r = +e.target.value;
    if (r === state.rings) return;
    pushHistory();
    state.rings = r;
    state.zoom = 1;
    evictInvalidSeats();
    renderAll();
  });

  $('#chkCoords').addEventListener('change', e => {
    state.showCoords = e.target.checked;
    draw();
    scheduleSave();
  });

  /* --- 导出图片水印（留空不显示），随数据自动保存 --- */
  const wmInput = $('#inWatermark');
  if (wmInput) {
    wmInput.value = state.watermark;
    wmInput.addEventListener('input', e => {
      state.watermark = e.target.value.trim();
      scheduleSave();
    });
  }

  $('#btnApplyCenter').addEventListener('click', () => {
    const x = parseInt($('#inCX').value, 10);
    const y = parseInt($('#inCY').value, 10);
    if (!(x >= 1 && x <= 9999 && y >= 1 && y <= 9999)) {
      alert('请输入有效的中心坐标（1-9999）');
      return;
    }
    if (x === state.center.x && y === state.center.y) return;
    pushHistory();
    state.center = { x, y };
    renderAll();
  });

  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnAuto').addEventListener('click', () => $('#btnCompact').click());
  $('#btnExport').addEventListener('click', exportPNG);

  /* --- 导出布局 CSV（与模板同字段） --- */
  $('#btnExportRoster').addEventListener('click', exportCSV);

  /* --- 清空城镇（炉子）：熊坑/旗子/禁用格保留，可撤销 --- */
  $('#btnClearTowns').addEventListener('click', () => {
    if (!state.members.length) { alert('当前没有城镇可清空'); return; }
    if (!confirm('确定清空全部 ' + state.members.length + ' 个城镇（炉子）？\n熊坑、联盟旗子、禁用格保留；可通过「撤销」恢复。')) return;
    pushHistory();
    state.members = [];
    state.selectedId = null;
    state.selectedEmpty = null;
    state.selectedCell = null;
    renderAll();
  });

  /* --- 更新最新数据：拉取线上最新内置名单，覆盖当前布局（可撤销） --- */
  $('#btnRefreshData').addEventListener('click', refreshDefaultData);

  /* --- 导入弹窗 --- */
  const modal = $('#modal');
  $('#btnImport').addEventListener('click', () => {
    $('#ta').value = state.members.map(m =>
      (m.flag ? '★' : '') + m.name + (m.x == null ? '' : ' ' + m.x + ',' + m.y)
    ).join('\n');
    $('#inCenter').value = state.center.x + ',' + state.center.y;
    $('#inRings').value = '';
    $('#fileName').textContent = '未选择文件';
    $('#fileName').classList.remove('ok');
    $('#fileRoster').value = '';
    modal.hidden = false;
    $('#ta').focus();
  });

  /* 选择 CSV / TXT 文件 → 读入文本框，并从文件名猜中心坐标 */
  $('#fileRoster').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      $('#ta').value = String(rd.result || '');
      $('#fileName').textContent = f.name;
      $('#fileName').classList.add('ok');
      const g = f.name.match(/(\d{3,4})\D+(\d{3,4})/);
      if (g) $('#inCenter').value = g[1] + ',' + g[2];
    };
    rd.readAsText(f, 'utf-8');
  });
  $('#btnCancel').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });

  $('#btnSample').addEventListener('click', () => {
    const rs = sampleRoster();
    $('#ta').value = rs.map(m => (m.flag ? '★' : '') + m.name + ' ' + m.x + ',' + m.y).join('\n');
  });

  $('#btnApply').addEventListener('click', () => {
    const text = $('#ta').value;
    // 优先按布局 CSV（含表头）解析
    const layout = Core.parseLayoutCSV(text);
    if (layout) {
      if (!layout.members.length && !layout.flags.length) {
        alert('CSV 中没有解析到城镇或旗子，请检查「游戏名称 / 目标X / 目标Y」列');
        return;
      }
      applyLayout(layout, $('#inCenter').value, $('#inRings').value);
      modal.hidden = true;
      return;
    }
    // 退回纯名单文本解析
    const list = parseRoster(text);
    if (!list.length) { alert('没有解析到有效成员，请检查格式'); return; }
    applyRoster(list, $('#inCenter').value, $('#inRings').value);
    modal.hidden = true;
  });

  new ResizeObserver(() => resize()).observe($('#canvasWrap'));
}

/* ============ 导出布局 CSV（字段与模板一致） ============ */
/* 文件名时间戳：年月日时分 YYYYMMDDHHmm */
function timeStamp(d) {
  const t = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return '' + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + p(t.getHours()) + p(t.getMinutes());
}

function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function exportCSV() {
  const cx = state.center.x, cy = state.center.y;
  const rows = [];
  const placed = sortedMembers().filter(m => m.seat);
  const unplaced = state.members.length - placed.length;

  for (const m of placed) {
    const gx = m.seat.gx, gy = m.seat.gy;
    const gap = gapToPit(gx, gy);
    rows.push({
      name: m.name,
      cat: m.cat || DEFAULT_CAT,
      x: cx + gx,
      y: cy + gy,
      ring: '第 ' + layoutRingOf(gap) + ' 圈',
      dist: (gap + 1.5).toFixed(1),
      note: m.note || '',
      cells: [
        (cx + gx) + ',' + (cy + gy),
        (cx + gx) + ',' + (cy + gy + 1),
        (cx + gx + 1) + ',' + (cy + gy),
        (cx + gx + 1) + ',' + (cy + gy + 1)
      ],
      type: '城镇',
      n: 4
    });
  }

  const mines = state.mines.slice().sort((a, b) => gapToPit(a.gx, a.gy) - gapToPit(b.gx, b.gy));
  mines.forEach(mn => {
    const gap = gapToPit(mn.gx, mn.gy);
    rows.push({
      name: '联盟矿',
      cat: '联盟矿',
      x: cx + mn.gx,
      y: cy + mn.gy,
      ring: '第 ' + layoutRingOf(gap) + ' 圈',
      dist: (gap + 1.5).toFixed(1),
      note: '不可放炉子',
      cells: [
        (cx + mn.gx) + ',' + (cy + mn.gy),
        (cx + mn.gx) + ',' + (cy + mn.gy + 1),
        (cx + mn.gx + 1) + ',' + (cy + mn.gy),
        (cx + mn.gx + 1) + ',' + (cy + mn.gy + 1)
      ],
      type: '联盟矿',
      n: 4
    });
  });

  const flags = state.flags.slice().sort((a, b) => gapToPit(a.gx, a.gy, 1) - gapToPit(b.gx, b.gy, 1));
  flags.forEach((f, i) => {
    const gap = gapToPit(f.gx, f.gy, 1);
    rows.push({
      name: '联盟旗子 ' + (i + 1),
      cat: '联盟旗子',
      x: cx + f.gx,
      y: cy + f.gy,
      ring: '-',
      dist: (gap + 1).toFixed(1),
      note: '',
      cells: [(cx + f.gx) + ',' + (cy + f.gy)],
      type: '联盟旗子',
      n: 1
    });
  });

  if (!rows.length) { alert('当前布局为空，无法导出'); return; }
  downloadFile('熊坑布局_' + cx + '_' + cy + '_' + timeStamp() + '.csv', Core.formatLayoutCSV(rows), 'text/csv;charset=utf-8');
  if (unplaced) {
    alert('已导出 ' + rows.length + ' 行（' + placed.length + ' 城镇 + ' + flags.length + ' 旗子）。\n另有 ' +
      unplaced + ' 个城镇未排位、没有坐标，未写入 CSV。');
  }
}

/* ============ 导出 PNG ============ */
function exportPNG() {
  const r = state.rings;
  const sceneW = (2 * r + 1) * TILE_W;
  const sceneH = (2 * r + 1) * TILE_H;
  const padX = 56;

  /* 左侧成员坐标清单：>60 人自动分两列 */
  const list = sortedMembers().filter(m => m.seat);
  const waitingN = state.members.length - list.length;
  const colCount = list.length > 60 ? 2 : 1;
  const sidebarW = colCount === 2 ? 330 : 225;

  const W = Math.max(padX * 2 + sidebarW + sceneW, 1100);
  const topH = 104;
  const botH = 86;
  const H = topH + sceneH + botH;
  const scale = 2;

  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);

  const g = ctx.createRadialGradient(W / 2, topH + sceneH / 2, 60, W / 2, topH + sceneH / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#0e2130');
  g.addColorStop(0.55, '#08131c');
  g.addColorStop(1, '#050b11');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 24px ' + FONT;
  ctx.fillText('联盟熊坑布局规划', padX, 46);

  const placed = state.members.filter(m => m.seat).length;
  const flags = state.members.filter(m => m.flag).length;
  ctx.fillStyle = '#8fa3b0';
  ctx.font = '13px ' + MONO;
  ctx.fillText(
    '熊坑中心 ' + state.center.x + ',' + state.center.y +
    '   ·   已布置 ' + placed + ' / ' + state.members.length +
    '   ·   联盟旗 ' + state.flags.length +
    '   ·   1坐标=1格 · 城镇2×2 · 旗子1格 · 熊坑3×3' +
    '   ·   圈数 ' + r,
    padX, 72
  );

  const prevHover = state.hover;
  const prevDrag = drag;
  const prevSelEmpty = state.selectedEmpty;
  const prevSelCell = state.selectedCell;
  state.hover = null;
  drag = null;
  state.selectedEmpty = null;
  state.selectedCell = null;
  drawScene(ctx, { tw: TILE_W, th: TILE_H, ox: padX + sidebarW + sceneW / 2, oy: topH + sceneH / 2 }, { coords: state.showCoords });
  state.hover = prevHover;
  drag = prevDrag;
  state.selectedEmpty = prevSelEmpty;
  state.selectedCell = prevSelCell;

  /* --- 左侧成员坐标清单 --- */
  if (list.length) {
    const px = padX, py = topH + 6;
    const pw = sidebarW - 18, ph = sceneH - 12;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 10);
    else ctx.rect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(10,24,33,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(58,140,160,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9fe8ff';
    ctx.font = '700 13px ' + FONT;
    ctx.fillText('成员坐标', px + 14, py + 24);
    ctx.fillStyle = '#7d93a3';
    ctx.font = '10px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText('按距坑心由近到远 · 共 ' + list.length + ' 人', px + pw - 12, py + 24);
    ctx.strokeStyle = 'rgba(58,140,160,0.3)';
    ctx.beginPath();
    ctx.moveTo(px + 10, py + 33);
    ctx.lineTo(px + pw - 10, py + 33);
    ctx.stroke();

    const rowsPerCol = Math.ceil(list.length / colCount);
    const colW = (pw - 20) / colCount;
    const listTop = py + 42;
    const rowH = Math.min(18, (ph - 52) / Math.max(rowsPerCol, 1));
    const fs = clamp(Math.floor(rowH - 4), 8, 12);
    const nameW = colW * 0.56;

    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const col = Math.floor(i / rowsPerCol);
      const row = i % rowsPerCol;
      const x0 = px + 12 + col * colW;
      const y = listTop + row * rowH + rowH / 2;

      if (row % 2 === 1) {
        ctx.fillStyle = 'rgba(86,200,232,0.05)';
        ctx.fillRect(x0 - 4, y - rowH / 2 + 1, colW - 6, rowH - 2);
      }

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = fs + 'px ' + FONT;
      const nm = (m.flag ? '⚑ ' : '') + m.name;
      ctx.fillStyle = m.flag ? '#c4a6ff' : '#cfe3ee';
      ctx.fillText(fitText(ctx, nm, nameW), x0, y);

      ctx.textAlign = 'right';
      ctx.font = fs + 'px ' + MONO;
      ctx.fillStyle = '#9fe8ff';
      ctx.fillText((state.center.x + m.seat.gx) + ',' + (state.center.y + m.seat.gy), x0 + colW - 12, y);

      if (col < colCount - 1 && row === 0) {
        ctx.strokeStyle = 'rgba(58,140,160,0.22)';
        ctx.beginPath();
        ctx.moveTo(px + 12 + colW * (col + 1) - 4, listTop - 4);
        ctx.lineTo(px + 12 + colW * (col + 1) - 4, listTop + rowsPerCol * rowH);
        ctx.stroke();
      }
    }

    if (waitingN > 0) {
      ctx.textAlign = 'left';
      ctx.font = '10px ' + FONT;
      ctx.fillStyle = 'rgba(255,154,154,0.85)';
      ctx.fillText('另有 ' + waitingN + ' 人未排位', px + 12, py + ph - 10);
    }
    ctx.restore();
  }

  const legendY = topH + sceneH + 34;
  let lx = padX;
  const items = [
    { label: '熊坑(3×3)', color: '#ffe9a8', bg: '#f0c34a' },
    { label: '联盟矿(2×2)', color: 'rgba(255,110,110,0.9)', bg: 'rgba(220,60,60,0.4)' },
    { label: '联盟旗子(1格)', color: 'rgba(160,120,255,0.9)', bg: 'rgba(88,58,160,0.6)' },
    { label: '禁用格', color: 'rgba(255,120,120,0.6)', bg: 'rgba(110,40,40,0.4)' }
  ];
  for (const [name, cc] of Object.entries(CATS)) {
    items.push({ label: name + '(2×2)', color: cc.stroke, bg: cc.fill });
  }
  ctx.textAlign = 'left';          // 前面成员名用 center，这里必须复位，否则图例文字错位
  ctx.textBaseline = 'middle';
  for (const it of items) {
    ctx.save();
    ctx.translate(lx + 6, legendY - 4);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = it.bg;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.fillStyle = '#8fa3b0';
    ctx.font = '12px ' + FONT;
    ctx.fillText(it.label, lx + 18, legendY);
    lx += 18 + ctx.measureText(it.label).width + 20;
  }

  ctx.textAlign = 'right';
  if (state.watermark) {
    ctx.fillStyle = 'rgba(125,147,163,0.6)';
    ctx.font = '11px ' + MONO;
    ctx.fillText(state.watermark, W - padX, legendY);
  }

  const a = document.createElement('a');
  a.download = '熊坑布局_' + state.center.x + '_' + state.center.y + '_' + timeStamp() + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
}

/* ============ 内置最新数据 ============ */
function defaultMeta() {
  const m = window.BEAR_DEFAULT_META || {};
  return { center: m.center || '628,523', updated: m.updated || '', towns: m.towns || 0 };
}

/* 拉取线上最新 default-data.js（绕过缓存）；失败返回 null */
async function fetchLatestDefault() {
  try {
    const res = await fetch('default-data.js?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const txt = await res.text();
    const m = txt.match(/BEAR_DEFAULT_CSV\s*=\s*("(?:[^"\\]|\\.)*")/);
    if (!m) return null;
    const layout = Core.parseLayoutCSV(JSON.parse(m[1]));
    return layout && layout.members.length ? layout : null;
  } catch (e) { return null; }
}

/* 「更新最新数据」：用最新内置名单覆盖当前布局，可撤销 */
async function refreshDefaultData() {
  const btn = $('#btnRefreshData');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '获取中…'; }

  /* 云端优先：KV 实时数据比内置名单更新，直接采用 */
  if (window.KVStore && KVStore.ok()) {
    try {
      const row = await KVStore.load('bearpit');
      const p = row && row.payload;
      if (p && p.data && Array.isArray(p.data.members)) {
        const d = JSON.stringify(p.data);
        const tmp = JSON.parse(d);
        const towns = tmp.members.length, flags = (tmp.flags || []).length, mines = (tmp.mines || []).length;
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (!confirm('将用云端实时数据覆盖当前布局（更新于 ' + (row.updated_at || '未知时间') + '）：\n' +
          '· 城镇 ' + towns + ' 座 · 旗子 ' + flags + ' 面 · 联盟矿 ' + mines + ' 处' +
          '\n\n可用「撤销」恢复。确定继续？')) return;
        undoStack.push(snapshot());
        restore(d);
        if (typeof p.showCoords === 'boolean') { state.showCoords = p.showCoords; $('#chkCoords').checked = p.showCoords; }
        if (typeof p.watermark === 'string') { state.watermark = p.watermark; const wm = $('#inWatermark'); if (wm) wm.value = p.watermark; }
        redoStack.length = 0;
        persistNow();
        alert('已更新为云端最新数据（' + (row.updated_at || '') + '）');
        return;
      }
    } catch (e) { /* 云端不可用 → 走内置名单兜底 */ }
  }

  let layout = await fetchLatestDefault();
  const fromNet = !!layout;
  if (!layout && window.BEAR_DEFAULT_CSV) {
    layout = Core.parseLayoutCSV(window.BEAR_DEFAULT_CSV);
  }
  if (btn) { btn.disabled = false; btn.textContent = label; }
  if (!layout || !layout.members.length) { alert('没有可用的内置名单数据，请检查网络后重试'); return; }

  const meta = defaultMeta();
  const towns = layout.members.length;
  const flags = layout.flags.length;
  const mines = (layout.mines || []).length;

  const msg = '将用最新内置名单覆盖当前布局：\n' +
    '· 城镇 ' + towns + ' 座 · 旗子 ' + flags + ' 面 · 联盟矿 ' + mines + ' 处' +
    (meta.updated ? '\n· 数据更新于 ' + meta.updated : '') +
    (fromNet ? '' : '\n（网络不可用，已使用页面内置数据）') +
    '\n\n当前布局（' + state.members.length + ' 座城镇）将被替换，可用「撤销」恢复。确定继续？';
  if (!confirm(msg)) return;

  applyLayout(layout, meta.center, '', { silent: true });
  alert('已更新为最新数据：城镇 ' + towns + ' 座 / 旗子 ' + flags + ' 面 / 联盟矿 ' + mines + ' 处（可撤销）');
}

function renderDataVersion() {
  const el = $('#dataVer');
  if (!el) return;
  const meta = defaultMeta();
  el.textContent = meta.updated ? ' ｜ 内置名单更新于 ' + meta.updated : '';
}

/* ============ 启动 ============ */
function boot() {
  setupEvents();
  renderLegend();
  renderDataVersion();

  const saved = loadSaved();
  if (saved) {
    // 有本地存档 → 恢复上次最新数据（含中心坐标、圈数、城镇、旗子、联盟矿、禁用格）
    restore(JSON.stringify(saved.data));
    if (typeof saved.showCoords === 'boolean') {
      state.showCoords = saved.showCoords;
      $('#chkCoords').checked = saved.showCoords;
    }
    if (typeof saved.watermark === 'string') {
      state.watermark = saved.watermark;
      const wm = $('#inWatermark');
      if (wm) wm.value = saved.watermark;
    }
    undoStack.length = 0;
    redoStack.length = 0;
    renderStats();
    draw();
  } else {
    // 首次打开（无存档）→ 加载内置默认布局
    let loaded = false;
    if (window.BEAR_DEFAULT_CSV) {
      const layout = Core.parseLayoutCSV(window.BEAR_DEFAULT_CSV);
      if (layout && (layout.members.length || layout.flags.length || (layout.mines || []).length)) {
        applyLayout(layout, defaultMeta().center, '', { silent: true });
        loaded = true;
      }
    }
    if (!loaded) applyRoster(sampleRoster(), '628,523', '');
    undoStack.length = 0;
    redoStack.length = 0;
    renderStats();
  }

  /* 云端优先：拉到 KV 数据则覆盖显示（实时数据以云端为准），并启动观察者轮询 */
  setupCloudUI();
  if (window.bindPublishButton) bindPublishButton(kvSync, $('#btnPublish'), $('#btnCloud'));
  if (kvSync) {
    kvSync.boot().then(row => { if (row) renderDataVersion(); });
    kvSync.startPolling();
  }
}

boot();

/* 测试句柄：无头 Chrome 端到端测试用（只读） */
window.__bearTest = { state, hitTest, tileCenter };
