/* 游戏攻略库 —— 列表 / 详情 / 编辑三视图 + Cloudflare KV 实时同步
   数据：{ v:1, posts:[{ id,title,category,summary,body,images,created,updated,pinned }] }
   图片：正文用 ![说明](img:N) 引用，base64 只存一份在 post.images[N] */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const KEY = 'guides.v1';

let posts = [];
let view = 'list';              // list | detail | editor
let curId = null;
let draft = null;               // 编辑中的副本，未保存前不写入 posts
let searchText = '';
let catFilter = '';
let previewOn = true;

function uid() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pad(n) { return n < 10 ? '0' + n : String(n); }
function beijing(d) { return new Date(d.getTime() + 8 * 3600 * 1000); }
function fmtTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  if (isNaN(d.getTime())) return '';
  const t = beijing(d);
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) + ' ' +
    pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes());
}
function stamp() {
  const t = beijing(new Date());
  return '' + t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) +
    pad(t.getUTCHours()) + pad(t.getUTCMinutes());
}

let toastTimer = null;
function toast(msg, warn) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast' + (warn ? ' warn' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, warn ? 6000 : 2800);
}

/* ---------- 数据层 ---------- */
function normalizePosts(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = Object.create(null);
  return arr.slice(0, 300).filter(p => p && typeof p === 'object').map(p => {
    let id = typeof p.id === 'string' && p.id ? p.id : uid();
    if (seen[id]) id = uid();
    seen[id] = 1;
    return {
      id: id,
      title: String(p.title == null ? '' : p.title).slice(0, 80) || '未命名攻略',
      category: String(p.category == null ? '' : p.category).slice(0, 20) || '未分类',
      summary: String(p.summary == null ? '' : p.summary).slice(0, 160),
      body: String(p.body == null ? '' : p.body).slice(0, 300000),
      images: Array.isArray(p.images)
        ? p.images.slice(0, 80).map(x => typeof x === 'string' ? x.slice(0, 900000) : '')
        : [],
      created: Number(p.created) || Date.now(),
      updated: Number(p.updated) || Date.now(),
      pinned: !!p.pinned
    };
  });
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.posts)) { posts = normalizePosts(o.posts); return; }
    }
  } catch (e) { /* 存档损坏 → 用内置示例 */ }
  posts = normalizePosts(window.GUIDES_DEFAULT || []);
  persistLocalOnly();
}

/* 只写本地，不触发云端上传（用于应用云端数据 / 拉云端覆盖后） */
function persistLocalOnly() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, posts })); return true; }
  catch (e) { toast('本地存储空间不足（内嵌图片过多）。若已解锁请及时点「☁ 发布」同步云端，或删减图片。', true); return false; }
}

/* 正常修改：写本地 + 防抖同步云端（未解锁时只写本地） */
function persist() {
  let s = null;
  try { s = JSON.stringify({ v: 1, posts }); } catch (e) { /* 忽略 */ }
  if (s) {
    if (s.length > 18 * 1024 * 1024) {
      toast('攻略数据已达 ' + (s.length / 1048576).toFixed(1) + 'MB，可能无法同步云端，建议删减内嵌图片或改用图片网址。', true);
    }
    try { localStorage.setItem(KEY, s); }
    catch (e) { toast('本地存储空间不足，图片过多；请及时点「☁ 发布」同步云端，或删减图片。', true); }
  }
  if (window.kvSync) kvSync.push();
}

const kvSync = window.makeKVSync ? window.makeKVSync({
  key: 'guides',
  debounceMs: 1500,
  pollMs: 30000,
  collect: () => ({ v: 1, posts }),
  apply: (o) => {
    if (!o || !Array.isArray(o.posts)) return;
    posts = normalizePosts(o.posts);
    persistLocalOnly();
    if (view === 'editor') { toast('云端攻略已更新；当前草稿不受影响，保存后以草稿为准'); return; }
    if (view === 'detail' && !posts.some(p => p.id === curId)) { view = 'list'; curId = null; }
    render();
  },
  onStatus: (t) => { if (window.setCloudStatus) setCloudStatus(t); },
  onLockExpired: () => { const b = $('#btnCloud'); if (b) b.textContent = '🔒 管理员'; updatePermUI(); }
}) : null;
window.kvSync = kvSync;

function setupCloudUI() {
  const btn = $('#btnCloud');
  if (!btn || !kvSync) { if (btn) btn.hidden = true; return; }
  btn.addEventListener('click', async () => {
    if (kvSync.isUnlocked()) {
      if (confirm('已解锁云端同步。要退出管理模式吗？')) {
        window.KVStore.setPass('');
        btn.textContent = '🔒 管理员';
        $('#cloudStatus').textContent = '';
        updatePermUI();
      }
      return;
    }
    const p = prompt('输入管理口令（修改将实时同步云端）');
    if (!p) return;
    btn.disabled = true;
    try {
      if (await kvSync.unlock(p)) { btn.textContent = '🔓 已解锁'; kvSync.push(); }
      else alert('口令不正确');
    } catch (e) { alert('解锁失败：' + String(e && e.message || e)); }
    btn.disabled = false;
    updatePermUI();
  });
}

function updatePermUI() {
  const can = !!(kvSync && kvSync.isUnlocked());
  ['btnNew', 'btnClearAll', 'btnExportBak', 'btnImportBak', 'btnEdit', 'btnDelete', 'btnPin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = !can;
  });
  const tip = $('#editTip');
  if (tip) tip.textContent = can
    ? '已解锁 · 保存后自动同步云端，盟友刷新即可看到'
    : '未解锁 · 仅本机编辑，请点顶栏「🔒 管理员」，或保存后点「☁ 发布」';
  const st = $('#stats');
  if (st) st.textContent = posts.length + ' 篇攻略';
}

/* ---------- 视图 ---------- */
function render() {
  $('#viewList').hidden = view !== 'list';
  $('#viewDetail').hidden = view !== 'detail';
  $('#viewEditor').hidden = view !== 'editor';
  updatePermUI();
  if (view === 'list') renderList();
  else if (view === 'detail') renderDetail();
  else renderEditor();
}
function go(v) { view = v; window.scrollTo(0, 0); render(); }

function coverOf(p) {
  const m = /!\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(p.body || '');
  if (!m) return '';
  let u = m[1];
  const im = /^img:(\d+)$/i.exec(u);
  if (im) u = (p.images || [])[Number(im[1])] || '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(u)) return u;
  return '';
}

function renderCats() {
  const box = $('#catChips');
  const cats = Array.from(new Set(posts.map(p => p.category || '未分类')))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (catFilter && !cats.includes(catFilter)) catFilter = '';
  box.textContent = '';
  const mk = (label, val, n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (val === catFilter ? ' active' : '');
    b.textContent = label;
    const s = document.createElement('span');
    s.className = 'num';
    s.textContent = n;
    b.appendChild(s);
    b.addEventListener('click', () => { catFilter = val; renderList(); });
    box.appendChild(b);
  };
  mk('全部', '', posts.length);
  cats.forEach(c => mk(c, c, posts.filter(p => (p.category || '未分类') === c).length));
}

function makeCard(p) {
  const el = document.createElement('div');
  el.className = 'post-card';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');

  const cover = document.createElement('div');
  cover.className = 'post-cover';
  const src = coverOf(p);
  if (src) {
    const im = document.createElement('img');
    im.src = src; im.alt = ''; im.loading = 'lazy';
    im.addEventListener('error', () => { cover.textContent = '📖'; });
    cover.appendChild(im);
  } else cover.textContent = '📖';

  const body = document.createElement('div');
  body.className = 'post-body';
  const cat = document.createElement('span');
  cat.className = 'post-cat' + (p.pinned ? ' warm' : '');
  cat.textContent = p.category || '未分类';
  const title = document.createElement('div');
  title.className = 'post-title';
  title.textContent = p.title;
  const sum = document.createElement('div');
  sum.className = 'post-sum';
  const plain = typeof mdPlainText === 'function' ? mdPlainText(p.body) : '';
  sum.textContent = p.summary || (plain.length > 92 ? plain.slice(0, 92) + '…' : plain) || '（暂无正文）';
  const foot = document.createElement('div');
  foot.className = 'post-foot';
  const t = document.createElement('span');
  t.textContent = fmtTime(p.updated) + ' 更新';
  const r = document.createElement('span');
  r.textContent = p.pinned ? '📌 置顶 · 阅读全文 →' : '阅读全文 →';
  foot.append(t, r);
  body.append(cat, title, sum, foot);
  el.append(cover, body);

  const open = () => { curId = p.id; go('detail'); };
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return el;
}

function renderList() {
  renderCats();
  const q = searchText.trim().toLowerCase();
  const list = posts.filter(p => {
    if (catFilter && (p.category || '未分类') !== catFilter) return false;
    if (!q) return true;
    const plain = typeof mdPlainText === 'function' ? mdPlainText(p.body) : String(p.body || '');
    return (p.title + ' ' + p.category + ' ' + p.summary + ' ' + plain).toLowerCase().indexOf(q) >= 0;
  });
  list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);

  $('#listCount').textContent = '共 ' + posts.length + ' 篇 · 当前显示 ' + list.length + ' 篇';
  const grid = $('#postGrid');
  grid.textContent = '';
  list.forEach(p => grid.appendChild(makeCard(p)));

  const empty = $('#listEmpty');
  empty.hidden = list.length > 0;
  $('#emptyTitle').textContent = posts.length ? '没有匹配的攻略' : '还没有攻略';
  $('#emptyText').textContent = posts.length
    ? '换个关键词，或点「全部」分类看看。'
    : '点顶栏「＋ 新建攻略」写第一篇；需要编辑权限请先点「🔒 管理员」解锁。';
}

function renderDetail() {
  const p = posts.find(x => x.id === curId);
  if (!p) { go('list'); return; }
  $('#dCat').textContent = p.category || '未分类';
  $('#dTime').textContent = '更新于 ' + fmtTime(p.updated) + '（北京时间）';
  $('#dPin').hidden = !p.pinned;
  $('#dTitle').textContent = p.title;
  $('#btnPin').textContent = p.pinned ? '📌 取消置顶' : '📌 置顶';
  const box = $('#dBody');
  try { box.innerHTML = renderMarkdown(p.body, p.images); }
  catch (e) { box.textContent = p.body; }
}

/* ---------- 编辑器 ---------- */
function openEditor(id) {
  const src = id ? posts.find(x => x.id === id) : null;
  draft = src ? JSON.parse(JSON.stringify(src)) : {
    id: uid(), title: '', category: '', summary: '', body: '', images: [],
    created: Date.now(), updated: Date.now(), pinned: false
  };
  draft.isNew = !src;
  curId = draft.id;
  go('editor');
}

function updatePreview() {
  if (!draft) return;
  const text = $('#eBody').value || '> 左边写正文，这里会实时显示排版效果。';
  try { $('#ePreview').innerHTML = renderMarkdown(text, draft.images || []); }
  catch (e) { $('#ePreview').textContent = text; }
}

function renderEditor() {
  if (!draft) { go('list'); return; }
  $('#eTitle').value = draft.title || '';
  $('#eCat').value = draft.category === '未分类' ? '' : (draft.category || '');
  $('#eSummary').value = draft.summary || '';
  $('#eBody').value = draft.body || '';

  const dl = $('#catList');
  dl.textContent = '';
  Array.from(new Set(posts.map(p => p.category).filter(Boolean))).forEach(c => {
    const o = document.createElement('option'); o.value = c; dl.appendChild(o);
  });

  $('#editorSplit').classList.toggle('no-preview', !previewOn);
  $('#btnTogglePreview').classList.toggle('on', previewOn);
  updatePreview();
  renderImgBar();
  updatePermUI();
}

const MD_SNIPS = {
  h2: ['## ', '小标题'],
  h3: ['### ', '小标题'],
  bold: ['**', '粗体文字', '**'],
  italic: ['*', '斜体文字', '*'],
  ul: ['- ', '列表项'],
  ol: ['1. ', '列表项'],
  quote: ['> ', '提示内容'],
  table: ['| 项目 | 说明 |\n| --- | --- |\n| A | 内容 A |\n| B | 内容 B |\n', ''],
  code: ['```\n', '代码或表格文本', '\n```'],
  hr: ['\n---\n', '']
};

function insertMd(kind) {
  const ta = $('#eBody');
  const s = MD_SNIPS[kind];
  if (!s) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end);
  const prefix = s[0], suffix = s.length > 2 ? s[2] : '';
  const text = sel || s[1] || '';
  const ins = prefix + text + suffix;
  ta.value = ta.value.slice(0, start) + ins + ta.value.slice(end);
  ta.focus();
  if (sel || !text) ta.setSelectionRange(start + ins.length, start + ins.length);
  else ta.setSelectionRange(start + prefix.length, start + prefix.length + text.length);
  updatePreview();
}

function insertAtCursor(text) {
  const ta = $('#eBody');
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.focus();
  ta.setSelectionRange(s + text.length, s + text.length);
  updatePreview();
}

/* 压缩后的 dataURL 加入草稿并在光标处插入引用；也供自动化验证直接调用 */
function insertImageDataUrl(dataUrl, name) {
  if (!draft) return -1;
  if (!draft.images) draft.images = [];
  if (draft.images.length >= 80) { toast('单篇攻略最多内嵌 80 张图片', true); return -1; }
  const idx = draft.images.length;
  draft.images.push(dataUrl);
  const label = String(name || '图片').replace(/[\[\]()]/g, '').slice(0, 24);
  insertAtCursor('![' + label + '](img:' + idx + ')');
  renderImgBar();
  return idx;
}
window.insertGuideImage = insertImageDataUrl;

async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('图片读取失败'));
      im.src = url;
    });
    const MAX = 1280;
    const w0 = img.naturalWidth || 1, h0 = img.naturalHeight || 1;
    const scale = Math.min(1, MAX / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, w, h);
    cx.drawImage(img, 0, 0, w, h);
    let q = 0.82, out = cv.toDataURL('image/jpeg', q);
    while (out.length > 420000 && q > 0.42) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

async function addImageFiles(files) {
  const arr = Array.from(files || []).filter(f => /^image\//.test(f.type));
  if (!arr.length) { toast('没有检测到图片文件', true); return; }
  for (const f of arr) {
    try {
      const data = await compressImage(f);
      if (insertImageDataUrl(data, (f.name || '截图').replace(/\.[^.]+$/, '')) < 0) break;
    } catch (e) { toast('图片处理失败：' + (e && e.message || e), true); }
  }
}

function renderImgBar() {
  const imgs = (draft && draft.images) || [];
  $('#imgCount').textContent = imgs.filter(Boolean).length;
  const box = $('#imgThumbs');
  box.textContent = '';
  imgs.forEach((src, i) => {
    if (!src) return;
    const d = document.createElement('div');
    d.className = 'img-thumb';
    const im = document.createElement('img');
    im.src = src; im.alt = '图片 ' + i;
    im.title = '点击在光标处插入 ![](img:' + i + ')';
    im.addEventListener('click', () => insertAtCursor('![](img:' + i + ')'));
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = '✕';
    b.title = '移除这张图片（正文里的对应引用会失效）';
    b.addEventListener('click', () => { draft.images[i] = ''; renderImgBar(); updatePreview(); });
    const s = document.createElement('span');
    s.className = 'n'; s.textContent = '#' + i;
    d.append(im, b, s);
    box.appendChild(d);
  });
}

function saveDraft() {
  if (!draft) return;
  const title = $('#eTitle').value.trim();
  if (!title) { alert('请填写攻略标题'); $('#eTitle').focus(); return; }
  const now = Date.now();
  draft.title = title.slice(0, 80);
  draft.category = ($('#eCat').value.trim() || '未分类').slice(0, 20);
  draft.summary = $('#eSummary').value.trim().slice(0, 160);
  draft.body = $('#eBody').value.slice(0, 300000);
  draft.updated = now;
  const isNew = !!draft.isNew;
  delete draft.isNew;
  if (isNew) { draft.created = now; posts.unshift(draft); }
  else {
    const i = posts.findIndex(p => p.id === draft.id);
    if (i >= 0) posts[i] = draft; else posts.unshift(draft);
  }
  curId = draft.id;
  draft = null;
  persist();
  go('detail');
  toast('已保存' + (isNew ? '新攻略' : '修改') + (kvSync && kvSync.isUnlocked()
    ? '，正在同步云端' : '（仅本机，请点「☁ 发布」让盟友看到）'));
}

function cancelEdit() {
  if (!confirm('放弃本次编辑？未保存的修改会丢失。')) return;
  draft = null;
  go(posts.some(p => p.id === curId) ? 'detail' : 'list');
}

/* ---------- 备份 / 刷新 / 撤销 ---------- */
function backupPrev() {
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) localStorage.setItem(KEY + '.prev', cur);
  } catch (e) { /* 存储不可用时跳过备份 */ }
  $('#btnUndoRefresh').hidden = false;
}

function undoRefresh() {
  try {
    const raw = localStorage.getItem(KEY + '.prev');
    if (!raw) { alert('没有可撤销的更新'); return; }
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.posts)) throw new Error('备份内容损坏');
    posts = normalizePosts(o.posts);
    persist();
    $('#btnUndoRefresh').hidden = true;
    draft = null;
    go('list');
    toast('已撤销更新（已解锁时会自动同步云端）');
  } catch (e) { alert('撤销失败：' + (e && e.message || e)); }
}

async function refreshData() {
  const btn = $('#btnRefreshData');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '获取中…'; }
  const done = () => { if (btn) { btn.disabled = false; btn.textContent = label; } };

  if (window.KVStore && KVStore.ok()) {
    try {
      const row = await KVStore.load('guides');
      const p = row && row.payload;
      if (p && Array.isArray(p.posts)) {
        done();
        const info = window.fmtKVTime ? fmtKVTime(row.updated_at, true) : '云端';
        if (!confirm('将用云端实时数据覆盖当前内容（更新于 ' + info + '）：\n· ' + p.posts.length +
          ' 篇攻略\n\n当前内容会被替换，可点「↩ 撤销更新」恢复。继续？')) return;
        backupPrev();
        posts = normalizePosts(p.posts);
        persistLocalOnly();          /* 数据来自云端，无需回写 */
        draft = null;
        go('list');
        alert('已更新为云端最新数据：' + posts.length + ' 篇攻略（可撤销）');
        return;
      }
    } catch (e) { /* 云端不可用 → 走内置示例兜底 */ }
  }
  done();
  const demo = normalizePosts(window.GUIDES_DEFAULT || []);
  if (!confirm('云端暂无攻略数据，是否载入 ' + demo.length +
    ' 篇内置示例攻略？\n当前内容会被替换（可点「↩ 撤销更新」恢复）。')) return;
  backupPrev();
  posts = demo;
  persistLocalOnly();
  draft = null;
  go('list');
  toast('已载入内置示例攻略（可撤销）');
}

/* ---------- 事件绑定 ---------- */
$('#inSearch').addEventListener('input', e => { searchText = e.target.value; renderList(); });
$('#btnNew').addEventListener('click', () => openEditor(null));
$('#btnBackList').addEventListener('click', () => go('list'));
$('#btnEdit').addEventListener('click', () => openEditor(curId));
$('#btnCancel').addEventListener('click', cancelEdit);
$('#btnSave').addEventListener('click', saveDraft);
$('#btnRefreshData').addEventListener('click', refreshData);
$('#btnUndoRefresh').addEventListener('click', undoRefresh);

$('#btnPin').addEventListener('click', () => {
  const p = posts.find(x => x.id === curId);
  if (!p) return;
  p.pinned = !p.pinned;
  persist();
  renderDetail();
  updatePermUI();
  toast(p.pinned ? '已置顶' : '已取消置顶');
});

$('#btnDelete').addEventListener('click', () => {
  const p = posts.find(x => x.id === curId);
  if (!p) return;
  if (!confirm('确定删除攻略「' + p.title + '」？此操作不可撤销，建议先点「⬇ 导出备份」。')) return;
  posts = posts.filter(x => x.id !== curId);
  persist();
  curId = null;
  go('list');
  toast('已删除攻略');
});

$('#btnClearAll').addEventListener('click', () => {
  if (!posts.length) { toast('已经是空的了'); return; }
  if (!confirm('确定清空全部 ' + posts.length + ' 篇攻略？此操作不可撤销，建议先点「⬇ 导出备份」。')) return;
  posts = [];
  catFilter = '';
  searchText = '';
  $('#inSearch').value = '';
  persist();
  draft = null;
  go('list');
  toast('已清空全部攻略');
});

$('#btnExportBak').addEventListener('click', () => {
  const data = JSON.stringify({ v: 1, exported_at: new Date().toISOString(), posts }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '游戏攻略备份_' + stamp() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('已导出 ' + posts.length + ' 篇攻略的备份文件');
});

$('#btnImportBak').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    const arr = Array.isArray(o) ? o : (o && o.posts);
    if (!Array.isArray(arr)) throw new Error('文件里没有 posts 数组');
    if (!confirm('将用备份里的 ' + arr.length + ' 篇攻略替换当前 ' + posts.length +
      ' 篇（可点「↩ 撤销更新」恢复）。继续？')) return;
    backupPrev();
    posts = normalizePosts(arr);
    persist();
    catFilter = ''; searchText = ''; $('#inSearch').value = '';
    draft = null;
    go('list');
    toast('已导入 ' + posts.length + ' 篇攻略');
  } catch (err) { alert('导入失败：' + (err && err.message || err)); }
  e.target.value = '';
});

document.querySelectorAll('.md-tool[data-md]').forEach(b => {
  b.addEventListener('click', () => insertMd(b.dataset.md));
});
$('#btnTogglePreview').addEventListener('click', () => {
  previewOn = !previewOn;
  $('#editorSplit').classList.toggle('no-preview', !previewOn);
  $('#btnTogglePreview').classList.toggle('on', previewOn);
  updatePreview();
});
$('#btnPickImg').addEventListener('click', () => $('#fileImg').click());
$('#fileImg').addEventListener('change', async e => {
  await addImageFiles(e.target.files);
  e.target.value = '';
});
$('#btnImgUrl').addEventListener('click', () => {
  const u = prompt('输入图片网址（https://…）');
  if (!u) return;
  if (!/^https?:\/\//i.test(u.trim())) { alert('只支持 http/https 开头的图片网址'); return; }
  insertAtCursor('![图片](' + u.trim() + ')');
});
$('#eBody').addEventListener('input', () => updatePreview());
$('#eBody').addEventListener('paste', async e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
      const f = items[i].getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  e.preventDefault();
  await addImageFiles(files);
});
$('#btnCleanImgs').addEventListener('click', () => {
  if (!draft) return;
  const used = new Set();
  const re = /!\[[^\]\n]*\]\(img:(\d+)\)/gi;
  let m;
  while ((m = re.exec($('#eBody').value || ''))) used.add(Number(m[1]));
  let n = 0;
  (draft.images || []).forEach((v, i) => { if (v && !used.has(i)) { draft.images[i] = ''; n++; } });
  renderImgBar();
  updatePreview();
  toast(n ? '已清理 ' + n + ' 张未引用图片' : '没有未引用的图片');
});

/* ---------- 启动 ---------- */
load();
render();
setupCloudUI();
if (window.bindPublishButton) bindPublishButton(kvSync, $('#btnPublish'), $('#btnCloud'));
if (window.initCloudSync) initCloudSync(kvSync, $('#btnCloud'));
