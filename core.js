/* 熊坑落位核心算法（浏览器 / Node 通用） */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BearCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const cheb = (gx, gy) => Math.max(Math.abs(gx), Math.abs(gy));
  const key = (gx, gy) => gx + ',' + gy;

  /**
   * 生成可落位格子：切比雪夫半径内的菱形区域，去掉中心（熊坑）与联盟矿
   * 排序：内圈 → 外圈，同圈按极角，保证填充紧凑
   */
  function buildSeats(rings, mines) {
    const blocked = new Set((mines || []).map(m => key(m.gx, m.gy)));
    const seats = [];
    for (let gx = -rings; gx <= rings; gx++) {
      for (let gy = -rings; gy <= rings; gy++) {
        if (cheb(gx, gy) > rings) continue;
        if (gx === 0 && gy === 0) continue;
        if (blocked.has(key(gx, gy))) continue;
        seats.push({ gx, gy, ring: cheb(gx, gy), ang: Math.atan2(gy, gx) });
      }
    }
    seats.sort((a, b) => a.ring - b.ring || a.ang - b.ang);
    return seats;
  }

  /** 能容纳 count 人的最小圈数 */
  function autoRingsFor(count, mines, maxRings) {
    const max = maxRings || 10;
    for (let r = 1; r <= max; r++) {
      if (buildSeats(r, mines).length >= count) return r;
    }
    return max;
  }

  /**
   * 2×2 城镇（炉子）座位：返回所有左上角候选位
   * 一个成员占 (gx,gy)(gx+1,gy)(gx,gy+1)(gx+1,gy+1) 四格，
   * 要求四格都在圈内且不含被封锁格；blocked 为 "gx,gy" 字符串数组
   */
  function buildBlocks(rings, blockedKeys) {
    const blocked = new Set(blockedKeys || []);
    const seats = [];
    for (let gx = -rings; gx <= rings - 1; gx++) {
      for (let gy = -rings; gy <= rings - 1; gy++) {
        let ok = true;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const tx = gx + dx, ty = gy + dy;
          if (cheb(tx, ty) > rings || blocked.has(tx + ',' + ty)) { ok = false; break; }
        }
        if (!ok) continue;
        seats.push({
          gx, gy,
          ring: Math.round(Math.max(Math.abs(gx + 0.5), Math.abs(gy + 0.5))),
          ang: Math.atan2(gy + 0.5, gx + 0.5)
        });
      }
    }
    seats.sort((a, b) => a.ring - b.ring || a.ang - b.ang);
    return seats;
  }

  /**
   * 就近落位：旗子/管理优先，其次按距坑距离由近到远，逐个占最近的空位
   * members: [{name, x, y, flag}]，center: {x, y}
   * 返回与入参等长数组，元素为 {gx, gy, ring} 或 null（超出容量）
   */
  function assignSeats(members, seats, center) {
    const distOf = m => (m.x == null || m.y == null)
      ? Infinity
      : Math.hypot(m.x - center.x, m.y - center.y);

    const order = members.map((m, i) => ({ m, i, d: distOf(m) }))
      .sort((a, b) => {
        if (!!a.m.flag !== !!b.m.flag) return a.m.flag ? -1 : 1;
        if (a.d !== b.d) return a.d - b.d;
        return a.i - b.i;
      });

    const result = new Array(members.length).fill(null);
    order.forEach((item, idx) => {
      const s = seats[idx];
      if (s) result[item.i] = { gx: s.gx, gy: s.gy, ring: s.ring };
    });
    return result;
  }

  const RE_COMMA = /(?<![\dA-Za-z])(\d{3,4})\s*[,，、]\s*(\d{3,4})(?![\dA-Za-z])/;
  const RE_SPACE = /(?<![\dA-Za-z])(\d{3,4})\s+(\d{3,4})(?![\dA-Za-z])/;

  /** 解析名单文本，兼容「名字 628,523」「628,523 名字」「名字\t628\t523」，★ 前缀 = 旗子 */
  function parseRoster(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      let line = raw.replace(/\u3000/g, ' ').trim();
      if (!line) continue;

      let flag = /^[★☆*·•✪]/.test(line) || /(旗|管理|车头|队长)/.test(line);
      line = line.replace(/^[★☆*·•✪]+\s*/, '');

      const m = line.match(RE_COMMA) || line.match(RE_SPACE);
      let x = null, y = null, name = line;

      if (m) {
        x = parseInt(m[1], 10);
        y = parseInt(m[2], 10);
        name = line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length);
      }
      name = name.replace(/[()（）\[\]【】]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[-—–:：,，\s]+|[-—–:：,，\s]+$/g, '')
        .trim();

      if (!name) continue;
      out.push({ name, x, y, flag });
    }
    return out;
  }

  /* ===== 布局 CSV（与「熊坑布局_628_523.csv」模板一致） ===== */
  const LAYOUT_HEADERS = ['序号', '游戏名称', '布局分类', '目标X', '目标Y', '圈层', '距离熊坑',
    '备注', '占地格1', '占地格2', '占地格3', '占地格4', '对象类型', '占地数量'];

  /** 极简 CSV 解析：支持引号包裹、"" 转义、BOM、CRLF */
  function csvRows(text) {
    const s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += ch;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === ',') { row.push(cell); cell = ''; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      if (ch === '\r') continue;
      cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * 解析布局 CSV。非 CSV（无「游戏名称」表头）返回 null。
   * 返回 { members:[{name,cat,x,y,note}], flags:[{x,y}] }，坐标均为游戏绝对坐标（城镇取 2×2 左上角）
   */
  function parseLayoutCSV(text) {
    const rows = csvRows(text);
    if (rows.length < 2) return null;
    const header = rows[0].map(h => String(h).replace(/\s/g, ''));
    if (!header.some(h => h.includes('游戏名称') || h.includes('名称'))) return null;
    if (!header.some(h => h.toUpperCase().includes('X'))) return null;

    const col = (...keys) => {
      for (const k of keys) {
        const i = header.findIndex(h => h.toUpperCase().includes(k.toUpperCase()));
        if (i >= 0) return i;
      }
      return -1;
    };
    const iName = col('游戏名称', '名称');
    const iCat = col('布局分类', '分类');
    const iX = col('目标X');
    const iY = col('目标Y');
    const iNote = col('备注');
    const iType = col('对象类型');

    const members = [], flags = [], mines = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const g = i => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
      const name = g(iName);
      const x = parseInt(g(iX), 10);
      const y = parseInt(g(iY), 10);
      if (!name || !(x > 0) || !(y > 0)) continue;
      const cat = g(iCat);
      const type = g(iType);
      if (/旗/.test(type) || /旗/.test(cat)) flags.push({ x, y });
      else if (/矿/.test(type) || /矿/.test(cat) || name === '联盟矿') mines.push({ x, y });
      else members.push({ name, cat, x, y, note: g(iNote) });
    }
    return { members, flags, mines };
  }

  /**
   * 生成布局 CSV 文本（含 UTF-8 BOM，Excel 直接打开不乱码）
   * rows: [{ name, cat, x, y, ring, dist, note, cells:[..], type, n }]
   */
  function formatLayoutCSV(rows) {
    const out = [LAYOUT_HEADERS.join(',')];
    (rows || []).forEach((r, i) => {
      const cells = r.cells || [];
      out.push([
        i + 1, r.name, r.cat, r.x, r.y, r.ring, r.dist, r.note,
        cells[0] || '', cells[1] || '', cells[2] || '', cells[3] || '',
        r.type, r.n != null ? r.n : (cells.length || 1)
      ].map(csvCell).join(','));
    });
    return '\uFEFF' + out.join('\r\n') + '\r\n';
  }

  return {
    cheb, key, buildSeats, buildBlocks, autoRingsFor, assignSeats, parseRoster,
    csvRows, parseLayoutCSV, formatLayoutCSV, LAYOUT_HEADERS
  };
});
