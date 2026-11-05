/* 堡垒开启时间 —— 联盟分配 / 时间排序 / 拖拽排序 / 导出图片与 CSV */
'use strict';

/* ============ 状态与持久化 ============ */
const KEY = 'fortress.layout.v1';

const SAMPLE_ROWS = [
  { al: 'VOE', fort: '3 号要塞',  time: '10:00', who: '' },
  { al: 'TOT', fort: '4 号堡垒',  time: '10:05', who: '' },
  { al: 'VOE', fort: '4 号要塞',  time: '12:00', who: '' },
  { al: 'TOT', fort: '2 号堡垒',  time: '12:05', who: '' },
  { al: 'VCR', fort: '7 号堡垒',  time: '12:10', who: '' },
  { al: 'VOE', fort: '12 号堡垒', time: '15:00', who: '' },
  { al: 'VOE', fort: '5 号堡垒',  time: '15:00', who: '' },
  { al: 'VOE', fort: '6 号堡垒',  time: '15:00', who: '' },
  { al: 'TOT', fort: '3 号堡垒',  time: '15:15', who: '' }
];
const SAMPLE_ALLIANCES = ['VOE', 'TOT', 'VCR'];
const SAMPLE_NOTICE = '19点开始发奖励 注意通知换盟领取';

/* 内置名单：优先用 default-data.js（数据源文件，「更新最新数据」按钮拉取），缺失时用上面的兕底 */
const INIT = window.FORTRESS_DEFAULT || { alliances: SAMPLE_ALLIANCES, rows: SAMPLE_ROWS, notice: SAMPLE_NOTICE };

let alliances = (INIT.alliances || SAMPLE_ALLIANCES).slice();
let rows = (INIT.rows || SAMPLE_ROWS).map((r, i) => Object.assign({ id: i + 1 }, r));
let notice = typeof INIT.notice === 'string' ? INIT.notice : SAMPLE_NOTICE;
/* 导出图片设置：标题 / 水印副标题 / 页脚署名 */
let expTitle = '堡垒要塞具体时间人员';
let expSub = '无尽冬日 · 堡垒开启时间表';
let expFoot = '永誓盟 · 工具站';
let nextId = rows.length + 1;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, alliances, rows, notice, nextId, exp: { title: expTitle, sub: expSub, foot: expFoot } }));
  } catch (e) { /* 存储不可用时忽略 */ }
  if (window.kvSync) kvSync.push();
}

/* ============ 云端实时同步（Cloudflare KV，公开读 + 口令写） ============ */
const kvSync = window.makeKVSync ? window.makeKVSync({
  key: 'fortress',
  debounceMs: 1200,
  pollMs: 30000,
  collect: () => ({ v: 1, alliances, rows, notice, nextId, exp: { title: expTitle, sub: expSub, foot: expFoot } }),
  apply: (o) => {
    try {
      if (!o || !Array.isArray(o.rows)) return;
      alliances = Array.isArray(o.alliances) && o.alliances.length ? o.alliances : alliances;
      rows = o.rows;
      notice = typeof o.notice === 'string' ? o.notice : notice;
      nextId = o.nextId || rows.length + 1;
      if (o.exp && typeof o.exp === 'object') {
        expTitle = typeof o.exp.title === 'string' ? o.exp.title : expTitle;
        expSub = typeof o.exp.sub === 'string' ? o.exp.sub : expSub;
        expFoot = typeof o.exp.foot === 'string' ? o.exp.foot : expFoot;
      }
      $('#inNotice').value = notice;
      $('#expTitle').value = expTitle;
      $('#expSub').value = expSub;
      $('#expFoot').value = expFoot;
      renderAll();
    } catch (e) { /* 云端数据损坏时忽略 */ }
  },
  onStatus: (t) => { if (window.setCloudStatus) setCloudStatus(t); },
  onLockExpired: () => { const b = $('#btnCloud'); if (b) b.textContent = '🔒 管理员'; }
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
        kvSync.push();
      } else alert('口令不正确');
    } catch (e) { alert(String(e.message || e)); }
    btn.disabled = false;
  });
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.rows)) return;
    alliances = Array.isArray(o.alliances) && o.alliances.length ? o.alliances : alliances;
    rows = o.rows;
    notice = typeof o.notice === 'string' ? o.notice : notice;
    nextId = o.nextId || rows.length + 1;
    if (o.exp && typeof o.exp === 'object') {
      expTitle = typeof o.exp.title === 'string' ? o.exp.title : expTitle;
      expSub = typeof o.exp.sub === 'string' ? o.exp.sub : expSub;
      expFoot = typeof o.exp.foot === 'string' ? o.exp.foot : expFoot;
    }
  } catch (e) { /* 损坏的存档按默认处理 */ }
}

/* 游戏内固定设施：12 座堡垒 + 4 座要塞，共 16 座 */
const FORT_NAMES = [];
for (let n = 1; n <= 12; n++) FORT_NAMES.push(n + ' 号堡垒');
for (let n = 1; n <= 4; n++) FORT_NAMES.push(n + ' 号要塞');

/* 开启时间段：仅 5 个节点，可另选加 0~55 分钟（如 15:00 + 15分 = 15:15） */
const TIME_SLOTS = ['10:00', '12:00', '15:00', '19:30', '21:00'];
const MIN_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
function slotMinutes(s) { const p = s.split(':'); return (+p[0]) * 60 + (+p[1]); }
function composeTime(slot, off) {
  if (!slot) return '';
  const t = slotMinutes(slot) + (+off || 0);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
/* 把已有时间拆回「节点 + 加分钟」，便于编辑时回显 */
function decomposeTime(t) {
  if (!t) return { slot: '', off: 0 };
  const p = t.split(':');
  const T = (+p[0]) * 60 + (+p[1]);
  let node = TIME_SLOTS[0];
  TIME_SLOTS.forEach(s => { if (slotMinutes(s) <= T) node = s; });
  let off = T - slotMinutes(node);
  if (off < 0) off = 0;
  if (off > 55) off = 55;
  return { slot: node, off: Math.round(off / 5) * 5 };
}

/* 名称归一化比较（忽略空格） */
function normFort(s) { return String(s || '').replace(/\s+/g, ''); }
function isKnownFort(s) { return FORT_NAMES.some(f => normFort(f) === normFort(s)); }

/* 联盟颜色（按名字哈希取柔和色） */
const AL_COLORS = ['#56c8e8', '#f0c34a', '#38c870', '#ff8fab', '#b48cff', '#ffa05c', '#7ad0ff', '#c0ff8c', '#ff7b6b', '#8ea9ff'];
function alColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AL_COLORS[h % AL_COLORS.length];
}

/* ============ 工具函数 ============ */
const $ = s => document.querySelector(s);
function timeStamp(d) {
  const t = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return '' + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + p(t.getHours()) + p(t.getMinutes());
}

/* ============ 渲染 ============ */
function renderAllianceUI() {
  // 添加行的联盟下拉
  const sel = $('#fAl');
  const cur = sel.value;
  sel.textContent = '';
  alliances.forEach(name => {
    const op = document.createElement('option');
    op.value = name; op.textContent = name;
    sel.appendChild(op);
  });
  if (alliances.includes(cur)) sel.value = cur;

  // 联盟管理 chips
  const box = $('#alChips');
  box.textContent = '';
  alliances.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'al-chip';
    const dot = document.createElement('i');
    dot.style.background = alColor(name);
    const label = document.createElement('b');
    label.textContent = name;
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '✕'; del.title = '删除该联盟（其堡垒保留，联盟置空）';
    del.addEventListener('click', () => {
      if (!confirm('删除联盟「' + name + '」？其名下堡垒的联盟将置空。')) return;
      alliances = alliances.filter(a => a !== name);
      rows.forEach(r => { if (r.al === name) r.al = ''; });
      persist(); renderAll();
    });
    chip.append(dot, label, del);
    box.appendChild(chip);
  });

  // 堡垒名建议（固定 16 座）
  const dl = $('#fortList');
  dl.textContent = '';
  FORT_NAMES.forEach(name => {
    const op = document.createElement('option');
    op.value = name;
    dl.appendChild(op);
  });
}

function renderTable() {
  const tbody = $('#tbody');
  tbody.textContent = '';
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.dataset.id = r.id;

    const tdDrag = document.createElement('td');
    tdDrag.className = 'handle';
    tdDrag.textContent = '⠿';
    tdDrag.title = '拖动排序';

    const tdAl = document.createElement('td');
    tdAl.className = 'td-al';
    tdAl.title = '点击切换联盟';
    if (r.al) {
      const dot = document.createElement('i');
      dot.className = 'al-dot';
      dot.style.background = alColor(r.al);
      const b = document.createElement('span');
      b.className = 'al-name';
      b.textContent = r.al;
      tdAl.append(dot, b);
    } else {
      const b = document.createElement('span');
      b.className = 'al-name empty';
      b.textContent = '—';
      tdAl.appendChild(b);
    }
    tdAl.addEventListener('click', () => editAllianceInline(tdAl, r));

    const tdFort = document.createElement('td');
    tdFort.className = 'fort-name';
    tdFort.textContent = r.fort;

    const tdTime = document.createElement('td');
    tdTime.className = 'td-time';
    const spanT = document.createElement('span');
    spanT.className = 'time-txt' + (r.time ? '' : ' empty');
    spanT.textContent = r.time || '未填';
    spanT.title = '点击直接修改时间';
    spanT.addEventListener('click', () => editTimeInline(tdTime, r));
    tdTime.appendChild(spanT);

    const tdWho = document.createElement('td');
    tdWho.className = 'td-who';
    const spanW = document.createElement('span');
    spanW.className = 'who-txt' + (r.who ? '' : ' empty');
    spanW.textContent = r.who || '—';
    spanW.title = '点击修改集结人员';
    spanW.addEventListener('click', () => editWhoInline(tdWho, r));
    tdWho.appendChild(spanW);

    const tdOp = document.createElement('td');
    const box = document.createElement('div');
    box.className = 'op-btns';
    const up = document.createElement('button');
    up.className = 'btn mini'; up.textContent = '↑'; up.title = '上移';
    up.disabled = idx === 0;
    up.addEventListener('click', () => move(idx, idx - 1));
    const down = document.createElement('button');
    down.className = 'btn mini'; down.textContent = '↓'; down.title = '下移';
    down.disabled = idx === rows.length - 1;
    down.addEventListener('click', () => move(idx, idx + 1));
    const del = document.createElement('button');
    del.className = 'btn mini del'; del.textContent = '删除';
    del.addEventListener('click', () => {
      if (!confirm('删除「' + (r.al || '') + ' ' + r.fort + '」？')) return;
      rows = rows.filter(x => x.id !== r.id);
      persist(); renderAll();
    });
    box.append(up, down, del);
    tdOp.appendChild(box);

    tr.append(tdDrag, tdAl, tdFort, tdTime, tdWho, tdOp);

    /* 拖拽排序 */
    tr.addEventListener('dragstart', e => {
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(r.id));
    });
    tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
    tr.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tr.classList.add('drag-over');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
    tr.addEventListener('drop', e => {
      e.preventDefault();
      tr.classList.remove('drag-over');
      const srcId = +e.dataTransfer.getData('text/plain');
      if (srcId === r.id) return;
      const from = rows.findIndex(x => x.id === srcId);
      if (from < 0) return;
      move(from, idx);
    });

    tbody.appendChild(tr);
  });
  $('#empty').hidden = rows.length > 0;
  $('#rowCount').textContent = rows.length + ' 座堡垒';
}

function renderStats() {
  const filled = rows.filter(r => r.time).length;
  $('#stats').textContent = rows.length + ' 座堡垒 · 已填时间 ' + filled + ' · 联盟 ' + alliances.length + ' 个';
}

function renderAll() {
  renderAllianceUI();
  renderTable();
  renderStats();
}

/* 行内切换联盟：点击联盟单元格 → 原地下拉 → 选完即保存 */
function editAllianceInline(td, row) {
  if (td.querySelector('select')) return;
  const sel = document.createElement('select');
  sel.className = 'al-edit';
  const opNone = document.createElement('option');
  opNone.value = ''; opNone.textContent = '— 无 —';
  sel.appendChild(opNone);
  alliances.forEach(name => {
    const op = document.createElement('option');
    op.value = name; op.textContent = name;
    sel.appendChild(op);
  });
  sel.value = row.al || '';
  td.textContent = '';
  td.appendChild(sel);
  sel.focus();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    row.al = sel.value;
    persist();
    renderTable();
    renderStats();
  };
  sel.addEventListener('change', commit);
  sel.addEventListener('blur', () => setTimeout(() => { if (!td.contains(document.activeElement)) renderTable(); }, 120));
  sel.addEventListener('keydown', e => { if (e.key === 'Escape') renderTable(); });
}

/* 行内修改集结人员：点击人员单元格 → 原地输入框 → 回车/失焦保存，Esc 取消 */
function editWhoInline(td, row) {
  if (td.querySelector('input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = row.who || '';
  input.maxLength = 30;
  input.className = 'who-edit';
  input.placeholder = '集结人员，可留空';
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const commit = save => {
    if (done) return;
    done = true;
    if (save) {
      row.who = input.value.trim();
      persist();
      renderTable();
    } else {
      renderTable();
    }
  };
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
}

/* 行内修改时间：点击时间单元格 → 出现「时间节点 + 加分钟」下拉 → 选完即保存 */
function editTimeInline(td, row) {
  if (td.querySelector('select')) return;
  const cur = decomposeTime(row.time);
  td.textContent = '';
  const box = document.createElement('div');
  box.className = 'time-edit-box';

  const selSlot = document.createElement('select');
  selSlot.className = 'time-edit';
  const opNone = document.createElement('option');
  opNone.value = ''; opNone.textContent = '未填';
  selSlot.appendChild(opNone);
  TIME_SLOTS.forEach(s => {
    const op = document.createElement('option');
    op.value = s; op.textContent = s;
    selSlot.appendChild(op);
  });
  selSlot.value = cur.slot;

  const selMin = document.createElement('select');
  selMin.className = 'time-edit';
  MIN_OPTIONS.forEach(m => {
    const op = document.createElement('option');
    op.value = String(m); op.textContent = '+' + String(m).padStart(2, '0');
    selMin.appendChild(op);
  });
  selMin.value = String(cur.off);

  const commit = () => {
    row.time = composeTime(selSlot.value, selMin.value);
    persist();
    renderTable();
    renderStats();
  };
  selSlot.addEventListener('change', commit);
  selMin.addEventListener('change', commit);
  /* 点到别处未做修改 → 恢复显示 */
  selSlot.addEventListener('blur', () => setTimeout(() => {
    if (!td.contains(document.activeElement)) renderTable();
  }, 120));
  selMin.addEventListener('blur', () => setTimeout(() => {
    if (!td.contains(document.activeElement)) renderTable();
  }, 120));
  selSlot.addEventListener('keydown', e => { if (e.key === 'Escape') renderTable(); });
  selMin.addEventListener('keydown', e => { if (e.key === 'Escape') renderTable(); });

  box.append(selSlot, selMin);
  td.appendChild(box);
  selSlot.focus();
}

function move(from, to) {
  if (to < 0 || to >= rows.length || from === to) return;
  const [it] = rows.splice(from, 1);
  rows.splice(to, 0, it);
  persist();
  renderTable();
  renderStats();
}

/* ============ 事件 ============ */
/* 时间节点 / 加分钟下拉（添加表单用） */
(function initTimeSelects() {
  const slot = $('#fSlot'), min = $('#fMin');
  const opNone = document.createElement('option');
  opNone.value = ''; opNone.textContent = '— 未填 —';
  slot.appendChild(opNone);
  TIME_SLOTS.forEach(s => {
    const op = document.createElement('option');
    op.value = s; op.textContent = s;
    slot.appendChild(op);
  });
  slot.value = '10:00';
  MIN_OPTIONS.forEach(m => {
    const op = document.createElement('option');
    op.value = String(m); op.textContent = '+' + String(m).padStart(2, '0') + ' 分';
    min.appendChild(op);
  });
})();

$('#btnAdd').addEventListener('click', () => {
  const fort = $('#fFort').value.trim();
  if (!fort) { alert('请填写堡垒要塞名称'); $('#fFort').focus(); return; }
  if (!isKnownFort(fort)) {
    alert('「' + fort + '」不在游戏设施列表中。\n游戏内共 16 座：12 座堡垒（1~12 号）+ 4 座要塞（1~4 号）。');
    $('#fFort').focus(); return;
  }
  if (rows.some(r => normFort(r.fort) === normFort(fort))) {
    alert('「' + fort + '」已在列表中，可直接在表格里点击时间修改。');
    return;
  }
  rows.push({
    id: nextId++,
    al: $('#fAl').value || '',
    fort: fort,
    time: composeTime($('#fSlot').value, $('#fMin').value),
    who: $('#fWho').value.trim()
  });
  $('#fFort').value = '';
  $('#fSlot').value = '10:00';
  $('#fMin').value = '0';
  $('#fWho').value = '';
  $('#fFort').focus();
  persist();
  renderAll();
});

/* 一键生成全部 16 座（12 堡垒 + 4 要塞），已存在的跳过 */
$('#btnInit16').addEventListener('click', () => {
  const have = new Set(rows.map(r => normFort(r.fort)));
  let added = 0;
  FORT_NAMES.forEach(name => {
    if (have.has(normFort(name))) return;
    rows.push({ id: nextId++, al: '', fort: name, time: '', who: '' });
    added++;
  });
  if (!added) { alert('16 座设施已全部在列表中。'); return; }
  persist();
  renderAll();
  if (confirm('已生成 ' + added + ' 座设施。要立即按名称顺序排列吗？')) {
    rows.sort((a, b) => FORT_NAMES.findIndex(f => normFort(f) === normFort(a.fort)) - FORT_NAMES.findIndex(f => normFort(f) === normFort(b.fort)));
    persist();
    renderTable();
  }
});

$('#btnSortTime').addEventListener('click', () => {
  rows.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  persist();
  renderTable();
});

/* 一键清空全部开启时间（联盟、人员保留），方便下次调整 */
$('#btnClearTime').addEventListener('click', () => {
  if (!rows.some(r => r.time)) { alert('当前没有已填的时间。'); return; }
  if (!confirm('清空全部 ' + rows.filter(r => r.time).length + ' 条开启时间？\n联盟、堡垒、人员保留，仅清空时间。')) return;
  rows.forEach(r => { r.time = ''; });
  persist();
  renderTable();
  renderStats();
});

$('#btnAddAl').addEventListener('click', () => {
  const name = $('#newAl').value.trim().toUpperCase();
  if (!name) return;
  if (alliances.includes(name)) { alert('联盟「' + name + '」已存在'); return; }
  alliances.push(name);
  $('#newAl').value = '';
  persist();
  renderAllianceUI();
  renderStats();
  $('#fAl').value = name;
});

$('#inNotice').addEventListener('input', e => {
  notice = e.target.value.trim();
  persist();
});

/* 导出图片设置输入框 */
[['expTitle', 'expTitle'], ['expSub', 'expSub'], ['expFoot', 'expFoot']].forEach(([id, key]) => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    if (key === 'expTitle') expTitle = el.value.trim();
    if (key === 'expSub') expSub = el.value.trim();
    if (key === 'expFoot') expFoot = el.value.trim();
    persist();
  });
});

/* ============ 导出 ============ */
$('#btnExportCsv').addEventListener('click', () => {
  const lines = ['序号,联盟,堡垒要塞,开启时间,开集结人员'];
  rows.forEach((r, i) => {
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    lines.push([i + 1, q(r.al), q(r.fort), q(r.time), q(r.who)].join(','));
  });
  downloadFile('堡垒要塞时间_' + timeStamp() + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
});

function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* 导出图片：堡垒要塞具体时间人员（美化版表格图） */
$('#btnExport').addEventListener('click', () => {
  const W = 920, pad = 28, rowH = 54, titleH = 100, headH = 56;
  const tableW = W - pad * 2;
  const cols = [140, 240, 160, tableW - 540]; // 联盟 / 堡垒要塞 / 时间 / 开集结人员
  const noticeH = notice ? 68 : 20;
  const footH = expFoot ? 34 : 16;
  const H = titleH + headH + rows.length * rowH + noticeH + footH;

  const scale = 2;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);

  const FONT = '"Microsoft YaHei","PingFang SC",system-ui,sans-serif';
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 标题栏（深蓝渐变 + 副标题）
  const g = ctx.createLinearGradient(0, 0, W, titleH);
  g.addColorStop(0, '#173f63');
  g.addColorStop(1, '#2e75b6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, titleH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 34px ' + FONT;
  if (expTitle) ctx.fillText(expTitle, W / 2, titleH / 2 - 10);
  if (expSub) {
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '400 14px ' + FONT;
    ctx.fillText(expSub, W / 2, titleH / 2 + 24);
  }

  // 表头
  const headY = titleH;
  const bodyTop = headY + headH;
  ctx.fillStyle = '#e8f2fb';
  ctx.fillRect(pad, headY, tableW, headH);
  ctx.fillStyle = '#2e75b6';
  ctx.fillRect(pad, bodyTop - 3, tableW, 3);
  const heads = ['联盟', '堡垒要塞', '时间', '开集结人员'];
  let hx = pad;
  ctx.fillStyle = '#12395c';
  ctx.font = '700 19px ' + FONT;
  ctx.textAlign = 'center';
  heads.forEach((h, i) => {
    ctx.fillText(h, hx + cols[i] / 2, headY + headH / 2);
    hx += cols[i];
  });

  // 数据行（淡黄斑马纹）
  rows.forEach((r, i) => {
    const y = bodyTop + i * rowH;
    ctx.fillStyle = i % 2 ? '#fff2cc' : '#fff8e2';
    ctx.fillRect(pad, y, tableW, rowH);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    let cx = pad;
    // 联盟（圆角色块 + 文字，整体居中）
    if (r.al) {
      ctx.font = '700 19px ' + FONT;
      const tw = ctx.measureText(r.al).width;
      const total = 14 + 8 + tw;
      const sx = cx + (cols[0] - total) / 2;
      ctx.fillStyle = alColor(r.al);
      rr(sx, y + rowH / 2 - 7, 14, 14, 4);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'left';
      ctx.fillText(r.al, sx + 22, y + rowH / 2);
    } else {
      ctx.fillStyle = '#9aa7b0';
      ctx.font = '400 18px ' + FONT;
      ctx.fillText('—', cx + cols[0] / 2, y + rowH / 2);
    }
    cx += cols[0];
    // 堡垒
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '700 19px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(r.fort, cx + cols[1] / 2, y + rowH / 2);
    cx += cols[1];
    // 时间
    ctx.fillStyle = r.time ? '#7a4f01' : '#9aa7b0';
    ctx.font = '800 20px ' + FONT;
    ctx.fillText(r.time || '—', cx + cols[2] / 2, y + rowH / 2);
    cx += cols[2];
    // 人员
    ctx.fillStyle = r.who ? '#1a1a1a' : '#9aa7b0';
    ctx.font = '400 18px ' + FONT;
    ctx.fillText(r.who || '—', cx + cols[3] / 2, y + rowH / 2);
    ctx.textAlign = 'center';
  });

  // 内部网格线（浅金）
  ctx.strokeStyle = '#ecd9a0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < rows.length; i++) {
    const y = bodyTop + i * rowH;
    ctx.moveTo(pad, y); ctx.lineTo(pad + tableW, y);
  }
  [cols[0], cols[0] + cols[1], cols[0] + cols[1] + cols[2]].forEach(w => {
    const x = pad + w;
    ctx.moveTo(x, bodyTop);
    ctx.lineTo(x, bodyTop + rows.length * rowH);
  });
  ctx.stroke();

  // 表格外框（蓝）
  ctx.strokeStyle = '#2e75b6';
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, headY, tableW, headH + rows.length * rowH);

  // 公告（红字圆角横幅）
  let yCur = bodyTop + rows.length * rowH;
  if (notice) {
    const ny = yCur + 14, nh = 50;
    ctx.fillStyle = '#fdecec';
    rr(pad, ny, tableW, nh, 10);
    ctx.fill();
    ctx.strokeStyle = '#f3c1c1';
    ctx.lineWidth = 1.5;
    rr(pad, ny, tableW, nh, 10);
    ctx.stroke();
    ctx.fillStyle = '#d93025';
    ctx.font = '800 24px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(notice, W / 2, ny + nh / 2);
    yCur = ny + nh;
    ctx.textAlign = 'left';
  }

  // 页脚（仅署名，不带时间）
  if (expFoot) {
    ctx.fillStyle = '#9aa7b0';
    ctx.font = '400 13px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(expFoot, W - pad, H - 16);
  }

  const a = document.createElement('a');
  a.download = '堡垒要塞时间_' + timeStamp() + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
});

/* ============ 更新最新数据：拉取线上最新内置名单，覆盖当前内容（可撤销） ============ */
/* 从 default-data.js 文本中解析 FORTRESS_DEFAULT 对象（按引号与括号配对扫描，失败返回 null） */
function parseDefaultFromText(txt) {
  const i = txt.indexOf('FORTRESS_DEFAULT =');
  if (i < 0) return null;
  const s = txt.indexOf('{', i);
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let k = s; k < txt.length; k++) {
    const ch = txt[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) { end = k; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(txt.slice(s, end + 1)); } catch (e) { return null; }
}

async function fetchLatestDefault() {
  try {
    const res = await fetch('default-data.js?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    return parseDefaultFromText(await res.text());
  } catch (e) { return null; }
}

function applyDefaultData(data) {
  if (!data || !Array.isArray(data.rows)) return false;
  if (Array.isArray(data.alliances) && data.alliances.length) alliances = data.alliances.map(String);
  if (typeof data.notice === 'string') notice = data.notice;
  rows = data.rows.map(r => Object.assign({ id: nextId++ },
    { al: String(r.al || ''), fort: String(r.fort || ''), time: String(r.time || ''), who: String(r.who || '') }));
  persist();
  $('#inNotice').value = notice;
  renderAll();
  return true;
}

async function refreshDefaultData() {
  const btn = $('#btnRefreshData');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '获取中…'; }

  /* 云端优先：KV 实时数据比内置名单更新，直接采用 */
  if (window.KVStore && KVStore.ok()) {
    try {
      const row = await KVStore.load('fortress');
      const p = row && row.payload;
      if (p && Array.isArray(p.rows)) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (!confirm('将用云端实时数据覆盖当前内容（更新于 ' + window.fmtKVTime(row.updated_at, true) + '）：\n' +
          '· ' + p.rows.length + ' 行堡垒时间安排' +
          (p.alliances ? '\n· 联盟：' + p.alliances.join(' / ') : '') +
          '\n\n当前内容将被替换（导出图片设置保留），可点「撤销更新」恢复。确定继续？')) return;
        try {
          const cur = localStorage.getItem(KEY);
          if (cur) localStorage.setItem(KEY + '.prev', cur);
        } catch (e) { /* 存储不可用时跳过备份 */ }
        alliances = Array.isArray(p.alliances) && p.alliances.length ? p.alliances : alliances;
        rows = p.rows;
        notice = typeof p.notice === 'string' ? p.notice : notice;
        nextId = p.nextId || rows.length + 1;
        $('#inNotice').value = notice;
        renderAll();
        persist();
        const undo = $('#btnUndoRefresh');
        if (undo) undo.hidden = false;
        alert('已更新为云端最新数据：' + rows.length + ' 行安排（' + window.fmtKVTime(row.updated_at, true) + '）（可撤销）');
        return;
      }
    } catch (e) { /* 云端不可用 → 走内置名单兜底 */ }
  }

  let data = await fetchLatestDefault();
  const fromNet = !!data;
  if (!data && window.FORTRESS_DEFAULT) data = window.FORTRESS_DEFAULT;
  if (btn) { btn.disabled = false; btn.textContent = label; }
  if (!data || !Array.isArray(data.rows)) { alert('没有可用的内置名单数据，请检查网络后重试'); return; }

  const meta = window.FORTRESS_DEFAULT_META || {};
  const msg = '将用最新内置名单覆盖当前内容：\n' +
    '· ' + data.rows.length + ' 行堡垒时间安排' +
    (data.alliances ? '\n· 联盟：' + data.alliances.join(' / ') : '') +
    (meta.updated ? '\n· 数据更新于 ' + meta.updated : '') +
    (fromNet ? '' : '\n（网络不可用，已使用页面内置数据）') +
    '\n\n当前内容将被替换（导出图片设置保留），可点「撤销更新」恢复。确定继续？';
  if (!confirm(msg)) return;

  try {
    const cur = localStorage.getItem(KEY);
    if (cur) localStorage.setItem(KEY + '.prev', cur);
  } catch (e) { /* 存储不可用时跳过备份 */ }
  if (applyDefaultData(data)) {
    const undo = $('#btnUndoRefresh');
    if (undo) undo.hidden = false;
    alert('已更新为最新数据：' + rows.length + ' 行安排（可撤销）');
  } else {
    alert('内置名单数据格式不正确，未做修改');
  }
}

function undoRefreshDefault() {
  let raw = null;
  try { raw = localStorage.getItem(KEY + '.prev'); } catch (e) {}
  if (!raw) { alert('没有可撤销的备份'); return; }
  try {
    localStorage.setItem(KEY, raw);
  } catch (e) { alert('恢复失败，存储不可用'); return; }
  load();
  $('#inNotice').value = notice;
  renderAll();
  const undo = $('#btnUndoRefresh');
  if (undo) undo.hidden = true;
  alert('已恢复到更新前的内容');
}

$('#btnRefreshData').addEventListener('click', refreshDefaultData);
$('#btnUndoRefresh').addEventListener('click', undoRefreshDefault);

/* ============ 启动 ============ */
load();
$('#inNotice').value = notice;
$('#expTitle').value = expTitle;
$('#expSub').value = expSub;
$('#expFoot').value = expFoot;
renderAll();

/* 云端优先：拉到 KV 数据则覆盖显示，并启动观察者轮询 */
setupCloudUI();
if (window.bindPublishButton) bindPublishButton(kvSync, $('#btnPublish'), $('#btnCloud'));
if (window.initCloudSync) initCloudSync(kvSync, $('#btnCloud'));
