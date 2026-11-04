const assert = require('node:assert');
const C = require('./core.js');

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  OK  ' + name); } catch (e) { console.log('  FAIL ' + name + ' → ' + e.message); process.exitCode = 1; } };

// ---- 座位 ----
t('圈数1：1格（去掉中心）', () => {
  assert.strictEqual(C.buildSeats(1, []).length, 8);
});
t('圈数5：11x11-1 = 120 格', () => {
  assert.strictEqual(C.buildSeats(5, []).length, 120);
});
t('联盟矿被排除', () => {
  const mines = [{ gx: -4, gy: -1 }, { gx: -1, gy: -4 }, { gx: 1, gy: 4 }, { gx: 4, gy: 1 }];
  assert.strictEqual(C.buildSeats(5, mines).length, 116);
});
t('autoRingsFor(100) = 5', () => {
  assert.strictEqual(C.autoRingsFor(100, [], 10), 5);
});
t('autoRingsFor(100, 4矿) = 5', () => {
  assert.strictEqual(C.autoRingsFor(100, [{ gx: -4, gy: -1 }, { gx: -1, gy: -4 }, { gx: 1, gy: 4 }, { gx: 4, gy: 1 }], 10), 5);
});
t('autoRingsFor 结果刚好装得下', () => {
  const r = C.autoRingsFor(200, [], 10);
  assert.ok(C.buildSeats(r, []).length >= 200, 'r=' + r + ' 装不下 200 人');
  assert.ok(C.buildSeats(r - 1, []).length < 200, 'r=' + r + ' 不是最小圈数');
});

// ---- 落位 ----
const center = { x: 628, y: 523 };
const members = [];
for (let i = 0; i < 100; i++) {
  members.push({ name: 'M' + i, x: 628 + (i % 7) - 3, y: 523 + (i % 5) - 2, flag: i % 5 === 0 });
}
t('100 人全部落位且不重叠', () => {
  const seats = C.buildSeats(5, []);
  const res = C.assignSeats(members, seats, center);
  const used = new Set();
  res.forEach(s => {
    assert.ok(s, '存在未落位成员');
    const k = s.gx + ',' + s.gy;
    assert.ok(!used.has(k), '座位重复: ' + k);
    assert.ok(!(s.gx === 0 && s.gy === 0), '占了中心熊坑');
    used.add(k);
  });
  assert.strictEqual(used.size, 100);
});
t('旗子优先获得内圈', () => {
  const seats = C.buildSeats(5, []);
  const res = C.assignSeats(members, seats, center);
  const flagRings = [], normalRings = [];
  members.forEach((m, i) => (m.flag ? flagRings : normalRings).push(res[i].ring));
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(flagRings) < avg(normalRings), `旗子平均圈${avg(flagRings).toFixed(2)} 未优于普通${avg(normalRings).toFixed(2)}`);
});
t('最近的人坐最内圈', () => {
  const near = { name: 'N', x: 628, y: 524, flag: false };
  const far = { name: 'F', x: 640, y: 540, flag: false };
  const res = C.assignSeats([far, near], C.buildSeats(3, []), center);
  assert.ok(res[1].ring <= res[0].ring, '近的人圈层应不大于远的人');
});

// ---- 解析 ----
t('名字在前 + 逗号坐标', () => {
  const r = C.parseRoster('Aaron 625,525');
  assert.deepStrictEqual(r, [{ name: 'Aaron', x: 625, y: 525, flag: false }]);
});
t('坐标在前', () => {
  const r = C.parseRoster('625，525 王十一');
  assert.strictEqual(r[0].name, '王十一');
  assert.strictEqual(r[0].x, 625);
});
t('名字里带数字不误判坐标', () => {
  const r = C.parseRoster('Aren729 627,525');
  assert.strictEqual(r[0].name, 'Aren729');
  assert.strictEqual(r[0].x, 627);
  assert.strictEqual(r[0].y, 525);
});
t('★ 识别为旗子', () => {
  const r = C.parseRoster('★王十一 635,527');
  assert.strictEqual(r[0].flag, true);
  assert.strictEqual(r[0].name, '王十一');
});
t('括号坐标 / 制表符', () => {
  const r = C.parseRoster('深渊(635,515)\n小狼\t631\t519');
  assert.strictEqual(r[0].name, '深渊');
  assert.strictEqual(r[0].x, 635);
  assert.strictEqual(r[1].name, '小狼');
  assert.strictEqual(r[1].y, 519);
});
t('只有名字也能解析（坐标为空）', () => {
  const r = C.parseRoster('随便一个人');
  assert.strictEqual(r[0].name, '随便一个人');
  assert.strictEqual(r[0].x, null);
  assert.strictEqual(r[0].y, null);
});
t('空行忽略', () => {
  assert.strictEqual(C.parseRoster('\n\n  \nA 628,523\n').length, 1);
});
t('无坐标成员排在最后', () => {
  // 圈1 共 8 个座位，塞满后无坐标的人只能去外圈
  const list = [];
  for (let i = 0; i < 8; i++) list.push({ name: 'p' + i, x: 628, y: 523, flag: false });
  list.push({ name: 'unknown', x: null, y: null, flag: false });
  const res = C.assignSeats(list, C.buildSeats(2, []), center);
  assert.strictEqual(res[8].ring, 2);
  assert.ok(res.slice(0, 8).every(s => s.ring === 1));
});

// ---- 2×2 城镇座位 ----
t('buildBlocks(1)：4 个候选位', () => {
  assert.strictEqual(C.buildBlocks(1, []).length, 4);
});
t('buildBlocks(6, 熊坑9格)：144-16=128', () => {
  const pit = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) pit.push((dx) + ',' + (dy));
  assert.strictEqual(C.buildBlocks(6, pit).length, 128);
});
t('buildBlocks 圈层由内到外排序', () => {
  const seats = C.buildBlocks(4, []);
  for (let i = 1; i < seats.length; i++) {
    assert.ok(seats[i - 1].ring <= seats[i].ring, 'ring 未排序');
  }
});
t('buildBlocks 排除被封锁格', () => {
  const total = C.buildBlocks(3, []).length;
  const less = C.buildBlocks(3, ['0,0', '1,1']);
  assert.ok(less.length < total);
});

/* ---- 布局 CSV ---- */
const fs = require('node:fs');
const CSV_PATH = 'H:/UserData/Downloads/熊坑布局_628_523.csv';
const hasCsv = fs.existsSync(CSV_PATH);

t('csvRows：引号内逗号不切分 + BOM 清理', () => {
  const rows = C.csvRows('\uFEFFa,b\n1,"625,525",x\n');
  assert.deepStrictEqual(rows[0], ['a', 'b']);
  assert.strictEqual(rows[1][1], '625,525');
});
t('parseLayoutCSV：解析真实模板文件', () => {
  if (!hasCsv) return;
  const r = C.parseLayoutCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  assert.ok(r, '应识别为 CSV');
  assert.strictEqual(r.members.length, 94, '城镇行数');
  assert.strictEqual(r.flags.length, 18, '旗子行数');
  assert.strictEqual(r.mines.length, 4, '联盟矿行数');
  assert.deepStrictEqual(r.mines[0], { x: 623, y: 514 });
  const first = r.members.find(m => m.name === 'Aaron');
  assert.ok(first, '应包含 Aaron');
  assert.strictEqual(first.x, 625);
  assert.strictEqual(first.y, 525);
  assert.strictEqual(first.cat, '车身');
  assert.deepStrictEqual(r.flags[0], { x: 630, y: 524 });
});
t('parseLayoutCSV：普通文本名单返回 null', () => {
  assert.strictEqual(C.parseLayoutCSV('Aaron 625,525'), null);
});
t('formatLayoutCSV：表头与行数正确、可回环解析', () => {
  const rows = [{
    name: '阿呆', cat: '地球', x: 631, y: 523, ring: '第 2 圈', dist: 3.5,
    note: '带,逗号', cells: ['631,523', '631,524', '632,523', '632,524'], type: '城镇', n: 4
  }, {
    name: '联盟旗子 1', cat: '联盟旗子', x: 630, y: 524, ring: '-', dist: 2,
    note: '', cells: ['630,524'], type: '联盟旗子', n: 1
  }];
  const txt = C.formatLayoutCSV(rows);
  assert.ok(txt.startsWith('\uFEFF'), '需带 BOM');
  const lines = txt.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0], C.LAYOUT_HEADERS.join(','));
  assert.ok(lines[1].includes('"带,逗号"'), '含逗号字段要加引号');
  const back = C.parseLayoutCSV(txt);
  assert.strictEqual(back.members.length, 1);
  assert.strictEqual(back.members[0].name, '阿呆');
  assert.strictEqual(back.members[0].note, '带,逗号');
  assert.strictEqual(back.flags.length, 1);
});

console.log(`\n通过 ${pass} 项`);
