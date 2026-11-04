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

let alliances = SAMPLE_ALLIANCES.slice();
let rows = SAMPLE_ROWS.map((r, i) => Object.assign({ id: i + 1 }, r));
let notice = SAMPLE_NOTICE;
let nextId = rows.length + 1;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, alliances, rows, notice, nextId }));
  } catch (e) { /* 存储不可用时忽略 */ }
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
  } catch (e) { /* 损坏的存档按默认处理 */ }
}

/* 游戏内固定设施：12 座堡垒 + 4 座要塞，共 16 座 */
const FORT_NAMES = [];
for (let n = 1; n <= 12; n++) FORT_NAMES.push(n + ' 号堡垒');
for (let n = 1; n <= 4; n++) FORT_NAMES.push(n + ' 号要塞');

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
    if (r.al) {
      const dot = document.createElement('i');
      dot.className = 'al-dot';
      dot.style.background = alColor(r.al);
      const b = document.createElement('span');
      b.className = 'al-name';
      b.textContent = r.al;
      tdAl.append(dot, b);
    } else {
      tdAl.textContent = '—';
      tdAl.style.color = 'var(--txt-dim)';
    }

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
    tdWho.textContent = r.who || '—';
    if (!r.who) tdWho.style.color = 'var(--txt-dim)';

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

/* 行内修改时间：点击时间单元格 → 弹出时间选择器 → 确认即保存 */
function editTimeInline(td, row) {
  if (td.querySelector('input')) return;
  const span = td.querySelector('.time-txt');
  const input = document.createElement('input');
  input.type = 'time';
  input.value = row.time || '';
  input.className = 'time-edit';
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  let done = false;
  const commit = save => {
    if (done) return;
    done = true;
    if (save) {
      row.time = input.value || '';
      persist();
      renderTable();
      renderStats();
    } else {
      renderTable();
    }
  };
  input.addEventListener('change', () => commit(true));
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
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
    time: $('#fTime').value || '',
    who: $('#fWho').value.trim()
  });
  $('#fFort').value = '';
  $('#fTime').value = '';
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

/* ============ 导出 ============ */
$('#btnExportCsv').addEventListener('click', () => {
  const lines = ['序号,联盟,堡垒要塞,开启时间,开集给人员'];
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

/* 导出图片：仿「堡垒要塞具体时间人员」表格样式 */
$('#btnExport').addEventListener('click', () => {
  const W = 920, pad = 24, rowH = 52, titleH = 92, headH = 54;
  const tableW = W - pad * 2;
  const cols = [150, 230, 150, tableW - 530]; // 联盟 / 堡垒要塞 / 时间 / 开集给人员
  const noticeH = notice ? 78 : 30;
  const H = titleH + headH + rows.length * rowH + noticeH + 26;

  const scale = 2;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);

  const FONT = '"Microsoft YaHei","PingFang SC",system-ui,sans-serif';

  // 背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 标题栏
  ctx.fillStyle = '#1f4e79';
  ctx.fillRect(0, 0, W, titleH);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 34px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('堡垒要塞具体时间人员', W / 2, titleH / 2);

  // 表头
  const headY = titleH;
  ctx.fillStyle = '#eaf3fb';
  ctx.fillRect(pad, headY, tableW, headH);
  const heads = ['联盟', '堡垒要塞', '时间', '开集给人员'];
  let hx = pad;
  ctx.fillStyle = '#12395c';
  ctx.font = '700 19px ' + FONT;
  heads.forEach((h, i) => {
    ctx.textAlign = 'left';
    ctx.fillText(h, hx + 18, headY + headH / 2);
    hx += cols[i];
  });

  // 表格线
  ctx.strokeStyle = '#2e75b6';
  ctx.lineWidth = 1.5;

  // 数据行（淡黄底）
  rows.forEach((r, i) => {
    const y = headY + headH + i * rowH;
    ctx.fillStyle = i % 2 ? '#fff2cc' : '#fff8e2';
    ctx.fillRect(pad, y, tableW, rowH);

    ctx.textBaseline = 'middle';
    let cx = pad;
    // 联盟（带色块）
    ctx.fillStyle = r.al ? alColor(r.al) : '#9aa7b0';
    ctx.fillRect(cx + 14, y + rowH / 2 - 6, 12, 12);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '700 19px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText(r.al || '—', cx + 36, y + rowH / 2);
    cx += cols[0];
    // 堡垒
    ctx.fillText(r.fort, cx + 18, y + rowH / 2);
    cx += cols[1];
    // 时间
    ctx.font = '700 20px ' + FONT;
    ctx.fillText(r.time || '—', cx + 18, y + rowH / 2);
    cx += cols[2];
    // 人员
    ctx.font = '400 18px ' + FONT;
    ctx.fillStyle = r.who ? '#1a1a1a' : '#9aa7b0';
    ctx.fillText(r.who || '', cx + 18, y + rowH / 2);
  });

  // 网格线
  ctx.beginPath();
  for (let i = 0; i <= rows.length; i++) {
    const y = headY + headH + i * rowH;
    ctx.moveTo(pad, y); ctx.lineTo(pad + tableW, y);
  }
  let gx = pad;
  [0, cols[0], cols[0] + cols[1], cols[0] + cols[1] + cols[2], tableW].forEach(w => {
    gx = pad + w;
    ctx.moveTo(gx, headY);
    ctx.lineTo(gx, headY + headH + rows.length * rowH);
  });
  ctx.stroke();
  ctx.strokeRect(pad, headY, tableW, headH + rows.length * rowH);

  // 公告（红字）
  if (notice) {
    ctx.fillStyle = '#e02020';
    ctx.font = '800 26px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(notice, W / 2, headY + headH + rows.length * rowH + 46);
  }

  const a = document.createElement('a');
  a.download = '堡垒要塞时间_' + timeStamp() + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
});

/* ============ 启动 ============ */
load();
$('#inNotice').value = notice;
renderAll();
