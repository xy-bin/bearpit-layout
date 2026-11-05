/* 兵工厂战略配置 —— 阶段分组 / 行内编辑 / 导出公示图片与 CSV */
'use strict';

/* ============ 状态与持久化 ============ */
const KEY = 'arsenal.layout.v1';

/* 游戏内建筑建议（来自兵工厂资源地图） */
const BUILDINGS = [
  '蒸汽锅炉', '蒸汽炉', '中转站', '武器维修厂1号', '武器维修厂2号', '武器维修厂3号', '武器维修厂4号',
  '武器实验厂1号', '武器实验厂2号', '皇家兵工厂', '军火库', '雇佣兵营地', '武器车间', '机动组人员'
];

const SAMPLE = {
  title: '军团一兵工厂（进语音！！！）',
  notice: ['开始前3分钟开反侦察，开宠物技能。注意战场频道信息，多看标签！！！', '大车头当前建筑没有威胁情况灵活支援就近建筑；', '采集开放时，中等战力可以前往采集；'],
  red: ['子弹和采集很重要，子弹和采集很重要，子弹和采集很重要！！！！'],
  stages: [
    {
      name: '第一阶段',
      rows: [
        { building: '蒸汽炉', leader: '晚风', body: '星河，不忘初心，米姐，猫猫爱喝可乐', note: '车头副队占领武器维修厂4号' },
        { building: '中转站', leader: '阿瑟', body: '甜甜圈，朵拉，肠的叹息，陈冠希', note: '' },
        { building: '武器实验厂1号', leader: 'BKrurd', body: 'BKKiss，阴雨天，我忘萌你了，你萌到我了', note: '车头副队占领武器维修厂1号' },
        { building: '武器实验厂2号', leader: '兔子', body: '大黄鸭子，妮蔻，绝对零度，就爱吃熊', note: '车头副队占领武器维修厂2号' },
        { building: '武器维修厂3号', leader: '涛哥', body: '酔过知酒浓，Molly，初冬心雪未眠，楠木', note: '' },
        { building: '机动组人员', leader: '/', body: '清雅，七姐，王者归来，虾仁，Aaron', note: '负责撞子弹和捡子弹，自由支援并远距离参与集结' }
      ]
    },
    {
      name: '第二阶段开始',
      rows: [
        { building: '皇家兵工厂', leader: 'BKrurd', body: 'BKKiss，阴雨天，我忘萌你了，你萌到我了', note: '车头副队占领武器实验厂1号' },
        { building: '军火库', leader: '兔子', body: '大黄鸭子，妮蔻，绝对零度，就爱吃熊', note: '车头副队占领武器维修厂2号' },
        { building: '蒸汽炉', leader: '晚风', body: '星河，不忘初心，米姐，猫猫爱喝可乐', note: '车头副队占领武器维修厂4号' },
        { building: '中转站', leader: '阿瑟', body: '甜甜圈，朵拉，肠的叹息，陈冠希', note: '车头副队占领武器实验厂2号' },
        { building: '武器维修厂3号', leader: '涛哥', body: '酔过知酒浓，Molly，初冬心雪未眠，楠木', note: '车头副队占领武器维修厂1号' },
        { building: '机动组人员', leader: '/', body: '清雅，七姐，王者归来，虾仁，Aaron', note: '负责撞子弹和捡子弹，自由支援并远距离参与集结' }
      ]
    }
  ]
};

/* 内置名单：优先用 default-data.js（数据源文件，「更新最新数据」按钮拉取），缺失时用上面的兜底 */
const INIT = window.ARSENAL_DEFAULT || SAMPLE;

let title = INIT.title;
let noticeLines = (INIT.notice || SAMPLE.notice).slice();
let redLines = (INIT.red || SAMPLE.red).slice();
let expFoot = '永誓盟 · 工具站';
let stages = [];
let nextId = 1;

function normStages(list) {
  return list.map(s => ({
    id: nextId++,
    name: String(s.name || ''),
    rows: (s.rows || []).map(r => ({
      id: nextId++,
      building: String(r.building || ''),
      leader: String(r.leader || ''),
      body: String(r.body || ''),
      note: String(r.note || '')
    }))
  }));
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, title, notice: noticeLines, red: redLines, expFoot, nextId,
      stages: stages.map(s => ({ name: s.name, rows: s.rows.map(r => ({ building: r.building, leader: r.leader, body: r.body, note: r.note })) }))
    }));
  } catch (e) { /* 存储不可用时忽略 */ }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.stages)) return;
    title = typeof o.title === 'string' ? o.title : title;
    if (Array.isArray(o.notice)) noticeLines = o.notice.map(String);
    if (Array.isArray(o.red)) redLines = o.red.map(String);
    if (typeof o.expFoot === 'string') expFoot = o.expFoot;
    nextId = o.nextId || 1;
    stages = normStages(o.stages);
  } catch (e) { /* 损坏存档按默认处理 */ }
}

/* ============ 工具函数 ============ */
const $ = s => document.querySelector(s);
function timeStamp(d) {
  const t = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return '' + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + p(t.getHours()) + p(t.getMinutes());
}

/* ============ 渲染 ============ */
function editCell(td, row, key, placeholder, datalistId) {
  if (td.querySelector('input')) return;
  const span = td.querySelector('.cell');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = row[key] || '';
  input.maxLength = 60;
  input.className = 'cell-edit';
  input.placeholder = placeholder || '';
  if (datalistId) input.setAttribute('list', datalistId);
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const commit = save => {
    if (done) return;
    done = true;
    if (save) {
      row[key] = input.value.trim();
      persist();
      renderStages();
    } else {
      renderStages();
    }
  };
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
}

function makeCell(row, key, cls, placeholder, datalistId) {
  const td = document.createElement('td');
  const span = document.createElement('span');
  span.className = 'cell ' + cls;
  if (row[key]) {
    span.textContent = row[key];
  } else {
    const d = document.createElement('i');
    d.className = 'dim';
    d.style.fontStyle = 'normal';
    d.textContent = '点击填写';
    span.appendChild(d);
  }
  span.title = '点击修改';
  span.addEventListener('click', () => editCell(td, row, key, placeholder, datalistId));
  td.appendChild(span);
  return td;
}

function renderStages() {
  const box = $('#stages');
  box.textContent = '';

  /* 全局建筑建议 datalist */
  let dl = document.getElementById('bList');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'bList';
    document.body.appendChild(dl);
  }
  dl.textContent = '';
  BUILDINGS.forEach(b => {
    const op = document.createElement('option');
    op.value = b;
    dl.appendChild(op);
  });

  stages.forEach((st, si) => {
    const card = document.createElement('div');
    card.className = 'stage-card';

    /* 阶段头 */
    const head = document.createElement('div');
    head.className = 'stage-head';
    const flag = document.createElement('div');
    flag.className = 'stage-flag';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'stage-name';
    name.value = st.name;
    name.maxLength = 20;
    name.title = '点击修改阶段名';
    name.addEventListener('change', () => { st.name = name.value.trim() || ('第' + (si + 1) + '阶段'); persist(); renderStages(); });
    const tools = document.createElement('div');
    tools.className = 'stage-tools';
    const mkBtn = (txt, cls, fn, dis, tip) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn mini ' + cls; b.textContent = txt; b.title = tip || '';
      b.disabled = !!dis;
      b.addEventListener('click', fn);
      return b;
    };
    tools.append(
      mkBtn('↑', '', () => moveStage(si, -1), si === 0, '阶段上移'),
      mkBtn('↓', '', () => moveStage(si, 1), si === stages.length - 1, '阶段下移'),
      mkBtn('＋ 添加行', '', () => {
        st.rows.push({ id: nextId++, building: '', leader: '', body: '', note: '' });
        persist(); renderStages();
      }, false, '在本阶段添加一行'),
      mkBtn('删除阶段', 'del', () => {
        if (!confirm('删除「' + (st.name || '未命名') + '」整个阶段（共 ' + st.rows.length + ' 行）？')) return;
        stages.splice(si, 1); persist(); renderStages(); renderStats();
      }, false, '删除该阶段')
    );
    head.append(flag, name, tools);
    card.appendChild(head);

    /* 表格 */
    if (!st.rows.length) {
      const es = document.createElement('div');
      es.className = 'empty-stage';
      es.textContent = '本阶段暂无安排，点「＋ 添加行」开始配置';
      card.appendChild(es);
    } else {
      const tbl = document.createElement('table');
      tbl.className = 'atable';
      tbl.appendChild(Object.assign(document.createElement('thead'), { innerHTML:
        '<tr><th style="width:18%">兵工厂安排</th><th style="width:12%">车头</th><th style="width:34%">车身（非固定，可以各自交换位置）</th><th style="width:30%">注意事项</th><th class="w-op"></th></tr>' }));
      const tbody = document.createElement('tbody');
      st.rows.forEach((r, ri) => {
        const tr = document.createElement('tr');
        tr.appendChild(makeCell(r, 'building', 'b-col', '如：蒸汽锅炉', 'bList'));
        tr.appendChild(makeCell(r, 'leader', 'l-col', '车头'));
        tr.appendChild(makeCell(r, 'body', 'body-col', '车身人员，顿号分隔'));
        tr.appendChild(makeCell(r, 'note', 'n-col', '注意事项'));

        const tdOp = document.createElement('td');
        const box2 = document.createElement('div');
        box2.className = 'op-btns';
        const up = document.createElement('button');
        up.className = 'btn mini'; up.textContent = '↑'; up.title = '上移';
        up.disabled = ri === 0;
        up.addEventListener('click', () => { const [it] = st.rows.splice(ri, 1); st.rows.splice(ri - 1, 0, it); persist(); renderStages(); });
        const down = document.createElement('button');
        down.className = 'btn mini'; down.textContent = '↓'; down.title = '下移';
        down.disabled = ri === st.rows.length - 1;
        down.addEventListener('click', () => { const [it] = st.rows.splice(ri, 1); st.rows.splice(ri + 1, 0, it); persist(); renderStages(); });
        const del = document.createElement('button');
        del.className = 'btn mini del'; del.textContent = '删除';
        del.addEventListener('click', () => {
          if (!confirm('删除「' + (r.building || '未填写') + '」这一行？')) return;
          st.rows.splice(ri, 1); persist(); renderStages(); renderStats();
        });
        box2.append(up, down, del);
        tdOp.appendChild(box2);
        tr.appendChild(tdOp);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      card.appendChild(tbl);
    }
    box.appendChild(card);
  });
}

function renderStats() {
  const totalRows = stages.reduce((n, s) => n + s.rows.length, 0);
  $('#stats').textContent = stages.length + ' 个阶段 · ' + totalRows + ' 行安排';
}

function renderAll() {
  $('#inTitle').value = title;
  $('#inNotice').value = noticeLines.join('\n');
  $('#inRed').value = redLines.join('\n');
  $('#inFoot').value = expFoot;
  renderStages();
  renderStats();
}

function moveStage(si, dir) {
  const to = si + dir;
  if (to < 0 || to >= stages.length) return;
  const [it] = stages.splice(si, 1);
  stages.splice(to, 0, it);
  persist();
  renderStages();
}

/* ============ 事件 ============ */
$('#inTitle').addEventListener('input', e => { title = e.target.value.trim(); persist(); });
$('#inNotice').addEventListener('input', e => { noticeLines = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); persist(); });
$('#inRed').addEventListener('input', e => { redLines = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); persist(); });
$('#inFoot').addEventListener('input', e => { expFoot = e.target.value.trim(); persist(); });

$('#btnAddStage').addEventListener('click', () => {
  stages.push({ id: nextId++, name: '第' + (stages.length + 1) + '阶段', rows: [] });
  persist();
  renderStages();
  renderStats();
});

/* ============ 导出 CSV ============ */
$('#btnExportCsv').addEventListener('click', () => {
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const lines = ['阶段,兵工厂安排,车头,车身（非固定）,注意事项'];
  stages.forEach(st => {
    st.rows.forEach(r => lines.push([q(st.name), q(r.building), q(r.leader), q(r.body), q(r.note)].join(',')));
  });
  downloadFile('兵工厂战略配置_' + timeStamp() + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
});

function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ============ 导出公示图片（仿飞书表格样式 + 兵工厂地图） ============ */
/* 文本按像素宽度折行 */
function wrapLines(ctx, text, maxW) {
  const out = [];
  let cur = '';
  for (const ch of String(text)) {
    if (ch === '\n') { out.push(cur); cur = ''; continue; }
    if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

$('#btnExport').addEventListener('click', () => {
  const mapImg = new Image();
  mapImg.onload = () => exportImage(mapImg);
  mapImg.onerror = () => exportImage(null);
  mapImg.src = 'map.jpg';
});

function exportImage(mapImg) {
  const W = 1080, pad = 22, gap = 3;
  const tableW0 = W - pad * 2;
  const cols = [190, 140, 370, tableW0 - 190 - 140 - 370 - gap * 3]; // 建筑 / 车头 / 车身 / 注意事项
  const titleH = 62;
  const nBlack = noticeLines.length, nRed = redLines.length;
  const noticeH = (nBlack + nRed) ? 20 + (nBlack + nRed) * 30 + 14 : 0;
  const headH = 42, bandH = 54, lineH = 21;
  const FONT = '"Microsoft YaHei","PingFang SC",system-ui,sans-serif';

  /* 预计算每行高度（按最长折行列） */
  const meas = document.createElement('canvas').getContext('2d');
  function cellLines(text, font, w) {
    meas.font = font;
    return wrapLines(meas, text, w - 14);
  }
  const cellFonts = {
    building: '700 17px ' + FONT,
    leader: '800 18px ' + FONT,
    body: '400 16.5px ' + FONT,
    note: '700 16px ' + FONT
  };
  stages.forEach(st => {
    st._rowH = st.rows.map(r => {
      const n = Math.max(1, ...['building', 'leader', 'body', 'note'].map(k => cellLines(r[k] || '', cellFonts[k], cols[['building', 'leader', 'body', 'note'].indexOf(k)]).length));
      return Math.max(46, n * lineH + 16);
    });
  });

  /* 地图高度 */
  const mapH = mapImg ? Math.round(tableW0 * mapImg.naturalHeight / mapImg.naturalWidth) : 0;
  const mapBandH = mapImg ? 40 : 0;

  let H = pad + titleH + (noticeH ? noticeH + gap : 0);
  stages.forEach(st => { H += (st.rows.length ? bandH + headH + st._rowH.reduce((a, b) => a + b, 0) : bandH) + gap; });
  if (mapImg) H += gap + mapBandH + gap + mapH;
  H += pad + 16;

  const scale = 2;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);

  function rr2(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const tableX = pad, tableW = W - pad * 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  /* 标题（浅蓝底；括号内文字红色） */
  ctx.fillStyle = '#d4e9f7';
  ctx.fillRect(tableX, pad, tableW, titleH);
  ctx.textBaseline = 'middle';
  ctx.font = '800 30px ' + FONT;
  const m = title.match(/^(.*?)(（[^）]*）)?$/);
  const t1 = m ? m[1] : title, t2 = m && m[2] ? m[2] : '';
  const w1 = ctx.measureText(t1).width, w2 = t2 ? ctx.measureText(t2).width : 0;
  let tx = (W - w1 - w2) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#16324a';
  ctx.fillText(t1, tx, pad + titleH / 2);
  if (t2) {
    ctx.fillStyle = '#e03131';
    ctx.fillText(t2, tx + w1, pad + titleH / 2);
  }

  /* 公告（浅黄底：黑粗体行 + 红粗体行） */
  let y = pad + titleH;
  if (noticeH) {
    ctx.fillStyle = '#fdf6d0';
    ctx.fillRect(tableX, y, tableW, noticeH);
    ctx.textAlign = 'center';
    let ly = y + 20 + 15;
    noticeLines.forEach(s => {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '700 18px ' + FONT;
      ctx.fillText(s, W / 2, ly);
      ly += 30;
    });
    redLines.forEach(s => {
      ctx.fillStyle = '#e03131';
      ctx.font = '800 18px ' + FONT;
      ctx.fillText(s, W / 2, ly);
      ly += 30;
    });
    y += noticeH + gap;
  }

  /* 各阶段 */
  const cellBg = { building: '#ddeff8', leader: '#f9c9cd', body: '#f7e27a', note: '#ddeff8' };
  const cellColor = { building: '#16324a', leader: '#1a1a1a', body: '#1a1a1a', note: '#d33030' };
  const keys = ['building', 'leader', 'body', 'note'];
  stages.forEach(st => {
    ctx.fillStyle = '#dcecfb';
    ctx.fillRect(tableX, y, tableW, bandH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#16324a';
    ctx.font = '800 26px ' + FONT;
    ctx.fillText(st.name || '未命名阶段', W / 2, y + bandH / 2);
    y += bandH;
    if (!st.rows.length) { y += gap; return; }

    ctx.fillStyle = '#7cc4ea';
    ctx.fillRect(tableX, y, tableW, headH);
    ctx.fillStyle = '#0d3a5c';
    ctx.font = '800 18px ' + FONT;
    const heads = ['兵工厂安排', '车头', '车身（非固定，可以各自交换位置）', '注意事项'];
    let hx = tableX;
    heads.forEach((h, i) => {
      ctx.fillText(h, hx + cols[i] / 2, y + headH / 2, cols[i] - 10);
      hx += cols[i] + gap;
    });
    y += headH;

    st.rows.forEach((r, ri) => {
      const rh = st._rowH[ri];
      let cx = tableX;
      keys.forEach((k, i) => {
        ctx.fillStyle = cellBg[k];
        ctx.fillRect(cx, y, cols[i], rh);
        if (r[k]) {
          const lines = cellLines(r[k], cellFonts[k], cols[i]);
          ctx.fillStyle = cellColor[k];
          ctx.font = cellFonts[k];
          ctx.textAlign = 'center';
          const startY = y + (rh - lines.length * lineH) / 2 + lineH / 2;
          lines.forEach((ln, li) => ctx.fillText(ln, cx + cols[i] / 2, startY + li * lineH, cols[i] - 12));
        }
        cx += cols[i] + gap;
      });
      y += rh;
    });
    y += gap;
  });

  /* 兵工厂地图 */
  if (mapImg) {
    ctx.fillStyle = '#d4e9f7';
    ctx.fillRect(tableX, y, tableW, mapBandH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#16324a';
    ctx.font = '800 20px ' + FONT;
    ctx.fillText('兵工厂资源地图（参考）', W / 2, y + mapBandH / 2);
    y += mapBandH + gap;
    ctx.drawImage(mapImg, tableX, y, tableW, mapH);
    y += mapH;
  }

  /* 页脚 */
  if (expFoot) {
    ctx.fillStyle = '#9aa7b0';
    ctx.font = '400 12px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(expFoot, W - pad, H - 12);
  }

  const a = document.createElement('a');
  a.download = '兵工厂战略配置_' + timeStamp() + '.png';
  let data;
  try {
    data = c.toDataURL('image/png');
  } catch (err) {
    /* 本地 file:// 打开时地图会污染画布，降级为不带地图导出 */
    alert('本地打开时无法把地图写入导出图片（浏览器安全限制），本次导出不含地图；线上网站使用可正常附带地图。');
    exportImage(null);
    return;
  }
  a.href = data;
  a.click();
}

/* ============ 更新最新数据：拉取线上最新内置名单，覆盖当前内容（可撤销） ============ */
/* 从 default-data.js 文本中解析 ARSENAL_DEFAULT 对象（按引号与括号配对扫描，失败返回 null） */
function parseDefaultFromText(txt) {
  const i = txt.indexOf('ARSENAL_DEFAULT =');
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
  if (!data || !Array.isArray(data.stages)) return false;
  title = typeof data.title === 'string' && data.title ? data.title : title;
  if (Array.isArray(data.notice)) noticeLines = data.notice.map(String);
  if (Array.isArray(data.red)) redLines = data.red.map(String);
  nextId = 1;
  stages = normStages(data.stages);
  persist();
  renderAll();
  return true;
}

async function refreshDefaultData() {
  const btn = $('#btnRefreshData');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '获取中…'; }
  let data = await fetchLatestDefault();
  const fromNet = !!data;
  if (!data && window.ARSENAL_DEFAULT) data = window.ARSENAL_DEFAULT;
  if (btn) { btn.disabled = false; btn.textContent = label; }
  if (!data || !Array.isArray(data.stages)) { alert('没有可用的内置名单数据，请检查网络后重试'); return; }

  const rows = data.stages.reduce((n, s) => n + (s.rows ? s.rows.length : 0), 0);
  const meta = window.ARSENAL_DEFAULT_META || {};
  const msg = '将用最新内置名单覆盖当前内容：\n' +
    '· ' + data.stages.length + ' 个阶段 · ' + rows + ' 行安排' +
    (meta.updated ? '\n· 数据更新于 ' + meta.updated : '') +
    (fromNet ? '' : '\n（网络不可用，已使用页面内置数据）') +
    '\n\n当前内容将被替换，可点「撤销更新」恢复。确定继续？';
  if (!confirm(msg)) return;

  try {
    const cur = localStorage.getItem(KEY);
    if (cur) localStorage.setItem(KEY + '.prev', cur);
  } catch (e) { /* 存储不可用时跳过备份 */ }
  if (applyDefaultData(data)) {
    const undo = $('#btnUndoRefresh');
    if (undo) undo.hidden = false;
    alert('已更新为最新数据：' + stages.length + ' 个阶段 / ' + rows + ' 行安排（可撤销）');
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
  renderAll();
  const undo = $('#btnUndoRefresh');
  if (undo) undo.hidden = true;
  alert('已恢复到更新前的内容');
}

$('#btnRefreshData').addEventListener('click', refreshDefaultData);
$('#btnUndoRefresh').addEventListener('click', undoRefreshDefault);

/* ============ 启动 ============ */
load();
if (!stages.length) stages = normStages(INIT.stages);
renderAll();
