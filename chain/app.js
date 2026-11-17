/* 接龙收集 · 前端逻辑
   - 成员端：公开读配置/活动列表，匿名提交（cid 隔离，仅能读/改自己那条），草稿存本地
   - 后台端：口令解锁（服务端校验），名单统计、筛选删除、CSV 导出、活动配置 */
(function () {
  'use strict';

  var PASS_KEY = 'kv.admin.pass';
  var acts = [], curAct = '', cfg = null, myEntry = null;
  var adminEntries = [], adminUnlocked = false, curTab = 'data';
  var drafts = {}, curView = 'list';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 填空类字段（文本 / 多行 / 数字）统一走 input，值为单个字符串 */
  function isTextLike(f) { return !!f && (f.type === 'text' || f.type === 'textarea' || f.type === 'number'); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  /* datetime-local（北京时间墙上时间）→ UTC ISO，避免浏览器时区差异 */
  function bjLocalToISO(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
    if (!m) return '';
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 8 * 3600000).toISOString();
  }
  /* UTC ISO → datetime-local（北京时间墙上时间） */
  function isoToBjLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    var t = new Date(d.getTime() + 8 * 3600000);
    return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate()) + 'T' + pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes());
  }
  function bjText(d) {
    var t = new Date(d.getTime() + 8 * 3600000);
    return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate()) + ' ' + pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes());
  }
  function getPass() {
    try {
      var p = localStorage.getItem(PASS_KEY);
      if (p) return p;
      var old = sessionStorage.getItem(PASS_KEY);
      if (old) { try { localStorage.setItem(PASS_KEY, old); } catch (e2) {} return old; }
    } catch (e) {}
    return '';
  }
  function setPass(p) {
    try {
      if (p) { localStorage.setItem(PASS_KEY, p); sessionStorage.setItem(PASS_KEY, p); }
      else { localStorage.removeItem(PASS_KEY); sessionStorage.removeItem(PASS_KEY); }
    } catch (e) {}
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function bj(s, withAgo) {
    if (!s) return '未知';
    var d = new Date(s); if (isNaN(d.getTime())) return String(s);
    var t = new Date(d.getTime() + 8 * 3600000);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    var out = t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
    if (withAgo) {
      var diff = Date.now() - d.getTime();
      out += '（' + (diff < 60000 ? '刚刚' : diff < 3600000 ? Math.floor(diff / 60000) + '分钟前' : diff < 86400000 ? Math.floor(diff / 3600000) + '小时前' : Math.floor(diff / 86400000) + '天前') + '）';
    }
    return out;
  }

  function actParam(a) { return 'act=' + encodeURIComponent(a || curAct); }
  async function api(path, opts) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    var r = await fetch('/api/chain/' + path + sep + 't=' + Date.now(), opts);
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { var err = new Error((j && j.error) || ('HTTP_' + r.status)); err.data = j; throw err; }
    return j;
  }
  /* Worker 从 URL 参数读 act；POST 的 body 也带 act，但必须同步进 URL，否则会落到 default 活动 */
  function post(path, obj) {
    var act = (obj && obj.act) || curAct;
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    return api(path + sep + actParam(act), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  }

  /* ---------- 活动列表 / 页面导航 ---------- */
  async function loadActs() {
    var remote = null;
    try { remote = (await api('acts')).acts; } catch (e) {}
    acts = (remote && remote.length) ? remote : (window.CHAIN_DEFAULT_ACTS || []).map(function (a) { return { id: a.id, title: a.title }; });
  }
  function renderList() {
    var grid = $('actGrid');
    if (!acts.length) {
      grid.innerHTML = '<div class="card empty">暂无接龙。进入管理后台「新建接龙」创建第一个。</div>';
      $('listCountPill').textContent = '0 个接龙';
      return;
    }
    $('listCountPill').textContent = '共 ' + acts.length + ' 个接龙';
    grid.innerHTML = acts.map(function (a) {
      var d = a.deadline ? new Date(a.deadline) : null;
      var statusCls, statusTxt;
      if (d && !isNaN(d.getTime())) {
        if (d.getTime() <= Date.now()) { statusCls = 'passed'; statusTxt = '已截止 · ' + bjText(d); }
        else { statusCls = 'live'; statusTxt = '进行中 · 截至 ' + bjText(d); }
      } else { statusCls = 'open'; statusTxt = '长期开放'; }
      return '<div class="card act-card" data-act="' + esc(a.id) + '">' +
        '<div class="act-card-top"><span class="act-status ' + statusCls + '">' + esc(statusTxt) + '</span></div>' +
        '<h3 class="act-card-title">' + esc(a.title || a.id) + '</h3>' +
        '<div class="act-card-meta">' + (a.fieldCount != null ? (a.fieldCount + ' 道题目 · ') : '') + 'ID：' + esc(a.id) + '</div>' +
        '<div class="act-card-ops"><button class="btn primary act-fill" data-act="' + esc(a.id) + '">📝 填写</button>' +
        '<button class="btn ghost act-manage" data-act="' + esc(a.id) + '">🛡 管理</button></div>' +
        '<div class="act-card-ops sub"><button class="btn ghost mini act-copy" data-act="' + esc(a.id) + '" title="复制全部题目配置，生成一个新接龙（不复制名单）">📋 复制</button>' +
        '<button class="btn danger mini act-delete" data-act="' + esc(a.id) + '" title="删除整个接龙及其全部名单，不可恢复">🗑 删除</button></div>' +
        '</div>';
    }).join('');
    grid.querySelectorAll('.act-fill').forEach(function (b) {
      b.addEventListener('click', function () { openFill(b.getAttribute('data-act')); });
    });
    grid.querySelectorAll('.act-manage').forEach(function (b) {
      b.addEventListener('click', function () { openAdmin(b.getAttribute('data-act')); });
    });
    grid.querySelectorAll('.act-copy').forEach(function (b) {
      b.addEventListener('click', function () { copyActDirect(b.getAttribute('data-act')); });
    });
    grid.querySelectorAll('.act-delete').forEach(function (b) {
      b.addEventListener('click', function () { deleteActDirect(b.getAttribute('data-act')); });
    });
  }

  /* 确保有可用管理口令：已登录（含首页/其它工具登录过）直接用，否则现场输入并校验 */
  async function ensurePass() {
    var p = getPass();
    if (p) return p;
    var input = (prompt('请输入管理口令后继续：') || '').trim();
    if (!input) { toast('已取消'); return null; }
    try {
      await post('admin', { act: curAct || 'default', passcode: input });
      setPass(input); adminUnlocked = true;
      return input;
    } catch (e) { toast('口令不正确'); return null; }
  }
  function passExpired(e) {
    if (e && e.data && e.data.error === 'INVALID_PASSCODE') {
      setPass(''); adminUnlocked = false; toast('口令已失效，请重新解锁'); return true;
    }
    return false;
  }

  /* 列表直接复制接龙：读取源配置 → 生成新 ID/标题 → 保存为新接龙（不复制名单） */
  async function copyActDirect(id) {
    var p = await ensurePass(); if (!p) return;
    try {
      var r = await api('config?' + actParam(id));
      var src = r.config;
      if (!src || !src.fields) { toast('读取源接龙配置失败'); return; }
      var base = (src.id || id).replace(/_copy[0-9a-z]+$/, '');
      var newId = (base + '_copy' + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      var payload = {
        title: (src.title || id) + '（副本）',
        notice: src.notice || '', deadline: src.deadline || '',
        fields: src.fields.map(function (f) {
          var o = { id: f.id, label: f.label || '未命名题目', type: f.type, required: !!f.required, placeholder: f.placeholder || '' };
          if (f.type === 'radio' || f.type === 'checkbox') o.options = f.options || [];
          if (f.type === 'number') { o.min = f.min || ''; o.max = f.max || ''; }
          return o;
        })
      };
      await post('config-save', { act: newId, passcode: p, config: payload });
      await loadActs(); renderList();
      toast('已复制为新接龙：' + payload.title);
    } catch (e) { if (!passExpired(e)) toast('复制失败：' + e.message); }
  }

  /* 列表直接删除接龙：确认后删除配置 + 全部名单 + 索引 */
  async function deleteActDirect(id) {
    var p = await ensurePass(); if (!p) return;
    var a = acts.find(function (x) { return x.id === id; });
    var name = (a && a.title) || id;
    if (!confirm('⚠️ 确定删除接龙「' + name + '」？该接龙的全部名单和配置将被永久删除，不可恢复。')) return;
    try {
      await post('delete-act', { act: id, passcode: p });
      if (curAct === id) curAct = '';
      await loadActs(); renderList();
      toast('已删除接龙：' + name);
    } catch (e) { if (!passExpired(e)) toast('删除失败：' + e.message); }
  }

  /* 视图切换：list 列表 / fill 填写 / admin 后台 */
  function showView(view) {
    curView = view;
    $('pageList').hidden = view !== 'list';
    $('pageFill').hidden = view !== 'fill';
    $('pageAdmin').hidden = view !== 'admin';
    $('btnBackList').hidden = view === 'list';
    $('btnCopyLink').hidden = view !== 'fill';
    $('topAdminGroup').hidden = true; /* 管理入口统一在列表卡片，填写页不再显示管理后台按钮 */
    window.scrollTo(0, 0);
  }
  function setUrl(view, act) {
    var url = location.pathname;
    if (view === 'list') {
      history.replaceState(null, '', url);
    } else {
      history.replaceState(null, '', url + '?act=' + encodeURIComponent(act || curAct) + '&view=' + view);
    }
  }
  async function openFill(act) {
    curAct = act;
    setUrl('fill', act);
    showView('fill');
    try { localStorage.setItem('chain.lastAct', act); } catch (e) {}
    await loadConfig();
  }
  async function openAdmin(act) {
    curAct = act;
    setUrl('admin', act);
    showView('admin');
    try { localStorage.setItem('chain.lastAct', act); } catch (e) {}
    var p = getPass();
    if (p) {
      /* 首页 / 其它工具已用同一口令登录过：直接校验进入，不再要求重复解锁 */
      try {
        var r = await post('admin', { act: curAct, passcode: p });
        adminUnlocked = true;
        adminEntries = r.entries || [];
        if (r.config) cfg = r.config;
        if (r.acts && r.acts.length) acts = r.acts;
        $('lockCard').hidden = true; $('adminBody').hidden = false;
        renderAdmin(); fillConfigEditor();
        return;
      } catch (e) { setPass(''); } /* 口令已失效，落到解锁卡让重新输入 */
    }
    adminUnlocked = false;
    $('adminPass').value = '';
    $('lockCard').hidden = false; $('adminBody').hidden = true;
  }
  function goList() {
    showView('list');
    setUrl('list');
    renderList();
  }
  async function loadConfig() {
    var remote = null;
    try { remote = (await api('config?' + actParam())).config; } catch (e) {}
    cfg = remote || (window.CHAIN_DEFAULT_ACTS || []).find(function (a) { return a.id === curAct; }) || {
      id: curAct, title: curAct, notice: '', fields: []
    };
    if (!cfg.fields) cfg.fields = [];
    renderForm();
    loadMyEntry();
  }
  function renderForm() {
    $('formTitle').textContent = cfg.title || '接龙收集';
    var nb = $('formNotice');
    if (cfg.notice) { nb.textContent = cfg.notice; nb.hidden = false; } else { nb.hidden = true; }
    var box = $('fields');
    box.innerHTML = cfg.fields.map(function (f, i) {
      var req = f.required ? '<span class="req">*</span>' : '';
      var tag = f.type === 'checkbox' ? '可多选' : f.type === 'radio' ? '单选' : f.type === 'number' ? '数字' : '填空';
      var ctrl = '';
      if (isTextLike(f)) {
        var attrs = ' class="q-input" data-fid="' + esc(f.id) + '" placeholder="' + esc(f.placeholder || '') + '"';
        if (f.type === 'number') {
          attrs += ' type="number" inputmode="decimal" step="any"';
          if (f.min !== undefined && f.min !== '') attrs += ' min="' + esc(f.min) + '"';
          if (f.max !== undefined && f.max !== '') attrs += ' max="' + esc(f.max) + '"';
        } else {
          attrs += ' type="text"';
        }
        ctrl = '<input' + attrs + ' />';
      } else {
        var opts = (f.options || []).map(function (o, oi) {
          var input = '<input type="' + (f.type === 'radio' ? 'radio' : 'checkbox') + '" name="f_' + esc(f.id) + '" value="' + esc(o) + '" data-fid="' + esc(f.id) + '" />';
          return '<label class="opt">' + input + '<span>' + esc(o) + '</span></label>';
        }).join('');
        ctrl = '<div class="opts">' + opts + '</div>';
      }
      return '<div class="q"><div class="q-label">' + req + esc(f.label) + '<span class="type-tag">' + tag + '</span></div>' + ctrl + '</div>';
    }).join('');
    // 绑定选项高亮
    box.querySelectorAll('.opt input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var group = inp.closest('.opts');
        if (inp.type === 'radio') group.querySelectorAll('.opt').forEach(function (o) { o.classList.remove('checked'); });
        inp.closest('.opt').classList.toggle('checked', inp.checked);
      });
    });
    applyDraft();
    renderDeadline();
  }

  /* 截止日期：成员端提示 + 禁止提交（服务端同样校验） */
  function renderDeadline() {
    var bar = $('deadlineBar'), btn = $('btnSubmit');
    var d = deadlineDate();
    if (!d) { bar.hidden = true; btn.disabled = false; return; }
    var passed = d.getTime() <= Date.now();
    bar.hidden = false;
    bar.classList.toggle('passed', passed);
    if (passed) {
      bar.textContent = '⛔ 本接龙已于 ' + bjText(d) + '（北京时间）截止，已停止接收提交';
      btn.disabled = true;
    } else {
      var ms = d.getTime() - Date.now();
      var left = ms >= 86400000 ? Math.ceil(ms / 86400000) + ' 天' : ms >= 3600000 ? Math.ceil(ms / 3600000) + ' 小时' : Math.max(1, Math.ceil(ms / 60000)) + ' 分钟';
      bar.textContent = '⏰ 截止：' + bjText(d) + '（北京时间）· 剩余 ' + left;
      btn.disabled = false;
    }
  }
  function deadlineDate() {
    if (!cfg || !cfg.deadline) return null;
    var d = new Date(cfg.deadline);
    return isNaN(d.getTime()) ? null : d;
  }

  function readForm() {
    var data = {};
    cfg.fields.forEach(function (f) {
      if (isTextLike(f)) {
        var inp = document.querySelector('[data-fid="' + f.id + '"].q-input');
        data[f.id] = inp ? inp.value.trim() : '';
      } else if (f.type === 'radio') {
        var r = document.querySelector('input[name="f_' + f.id + '"]:checked');
        data[f.id] = r ? r.value : '';
      } else if (f.type === 'checkbox') {
        var arr = Array.from(document.querySelectorAll('input[name="f_' + f.id + '"]:checked')).map(function (x) { return x.value; });
        data[f.id] = arr;
      }
    });
    return data;
  }
  function writeForm(data) {
    if (!data) return;
    cfg.fields.forEach(function (f) {
      var v = data[f.id];
      if (isTextLike(f)) {
        var inp = document.querySelector('[data-fid="' + f.id + '"].q-input');
        if (inp) inp.value = v || '';
      } else {
        document.querySelectorAll('input[name="f_' + f.id + '"]').forEach(function (x) {
          var on = Array.isArray(v) ? v.indexOf(x.value) >= 0 : (v === x.value);
          x.checked = on; x.closest('.opt').classList.toggle('checked', on);
        });
      }
    });
  }
  function draftKey() { return 'chain.draft.' + curAct; }
  function applyDraft() {
    try { var d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); if (d) writeForm(d); } catch (e) {}
  }
  function saveDraft() {
    try { localStorage.setItem(draftKey(), JSON.stringify(readForm())); toast('草稿已保存到本机'); } catch (e) { toast('草稿保存失败'); }
  }
  function validate(data) {
    for (var i = 0; i < cfg.fields.length; i++) {
      var f = cfg.fields[i], v = data[f.id];
      var empty = (f.type === 'checkbox') ? (!Array.isArray(v) || !v.length) : !v;
      if (f.required && empty) { toast('请填写：' + f.label); return false; }
      if (f.type === 'number' && !empty) {
        var n = Number(v);
        if (!isFinite(n)) { toast(f.label + ' 需填写数字'); return false; }
        if (f.min !== undefined && f.min !== '' && n < Number(f.min)) { toast(f.label + ' 不能小于 ' + f.min); return false; }
        if (f.max !== undefined && f.max !== '' && n > Number(f.max)) { toast(f.label + ' 不能大于 ' + f.max); return false; }
      }
    }
    return true;
  }
  async function loadMyEntry() {
    var cid = window.chainCid(curAct);
    try {
      var r = await api('mine?' + actParam() + '&cid=' + encodeURIComponent(cid));
      myEntry = r.entry || null;
      var st = $('myStatus');
      if (myEntry) {
        writeForm(myEntry.data || {});
        st.innerHTML = '✅ 你已提交（' + esc(bj(myEntry.updatedAt, true)) + '）。可修改后重新提交覆盖自己那条。';
        st.hidden = false;
      } else { st.hidden = true; }
    } catch (e) { /* 静默 */ }
  }
  async function submit() {
    var data = readForm();
    if (!validate(data)) return;
    var btn = $('btnSubmit'); btn.disabled = true; btn.textContent = '提交中…';
    try {
      await post('submit', { act: curAct, cid: window.chainCid(curAct), data: data });
      try { localStorage.removeItem(draftKey()); } catch (e) {}
      toast('提交成功，感谢参与！');
      await loadMyEntry();
    } catch (e) {
      var errCode = e.data && e.data.error;
      toast(errCode === 'DEADLINE_PASSED' ? '⛔ 本接龙已截止，无法提交' : ('提交失败：' + e.message));
    }
    btn.textContent = '提交'; renderDeadline();
  }

  /* ---------- 后台 ---------- */
  async function unlock() {
    var p = $('adminPass').value.trim();
    if (!p) { $('lockErr').textContent = '请输入口令'; $('lockErr').hidden = false; return; }
    $('lockErr').hidden = true;
    try {
      var r = await post('admin', { act: curAct, passcode: p });
      setPass(p); adminUnlocked = true;
      adminEntries = r.entries || [];
      if (r.acts && r.acts.length) { acts = r.acts; renderList(); }
      if (r.config) cfg = r.config;
      $('lockCard').hidden = true; $('adminBody').hidden = false;
      renderAdmin(); fillConfigEditor();
      toast('解锁成功');
    } catch (e) {
      $('lockErr').textContent = e.message === 'INVALID_PASSCODE' ? '口令不正确' : ('解锁失败：' + e.message);
      $('lockErr').hidden = false;
    }
  }
  async function refreshAdmin() {
    if (!adminUnlocked) return;
    try {
      var r = await post('admin', { act: curAct, passcode: getPass() });
      adminEntries = r.entries || [];
      if (r.config) cfg = r.config;
      if (r.acts && r.acts.length) acts = r.acts;
      renderAdmin();
    } catch (e) { toast('刷新失败：' + e.message); }
  }
  function switchTab(tab) {
    curTab = tab;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    $('tabData').hidden = tab !== 'data';
    $('tabConfig').hidden = tab !== 'config';
  }

  function fieldLabel(fid) {
    var f = cfg.fields.find(function (x) { return x.id === fid; });
    return f ? f.label.replace(/[（(].*$/, '') : fid;
  }
  function cellVal(f, v) {
    if (Array.isArray(v)) return v.join('、');
    return v == null ? '' : String(v);
  }
  function renderAdmin() {
    // 统计卡
    var total = adminEntries.length;
    var latest = total ? adminEntries[adminEntries.length - 1].updatedAt : '';
    $('statRow').innerHTML =
      '<div class="stat-box"><div class="num">' + total + '</div><div class="lbl">已提交人数</div></div>' +
      '<div class="stat-box"><div class="num">' + cfg.fields.length + '</div><div class="lbl">收集题目数</div></div>' +
      '<div class="stat-box"><div class="num" style="font-size:15px;line-height:26px">' + esc(bj(latest, false)) + '</div><div class="lbl">最近提交</div></div>';

    renderDistribution();
    renderFilterOptions();
    renderTable();
  }
  function renderDistribution() {
    var box = $('distribution');
    var parts = [];
    cfg.fields.forEach(function (f) {
      if (isTextLike(f) || !f.options || !f.options.length) return;
      var counts = {};
      f.options.forEach(function (o) { counts[o] = 0; });
      adminEntries.forEach(function (e) {
        var v = e.data && e.data[f.id];
        (Array.isArray(v) ? v : [v]).forEach(function (x) { if (x && counts[x] != null) counts[x]++; });
      });
      var rows = f.options.map(function (o) {
        var n = counts[o], pct = adminEntries.length ? Math.round(n / adminEntries.length * 100) : 0;
        return '<div class="dist-row"><div class="dist-name" title="' + esc(o) + '">' + esc(o) + '</div>' +
          '<div class="dist-bar-wrap"><div class="dist-bar" style="width:' + pct + '%"></div></div>' +
          '<div class="dist-val">' + n + ' 人 · ' + pct + '%</div></div>';
      }).join('');
      parts.push('<div class="dist-q"><div class="dist-q-title">' + esc(f.label) + '</div>' + rows + '</div>');
    });
    // 填空题：列出前若干条文本
    cfg.fields.forEach(function (f) {
      if (!isTextLike(f)) return;
      var vals = adminEntries.map(function (e) { return e.data && e.data[f.id]; }).filter(Boolean);
      if (!vals.length) return;
      parts.push('<div class="dist-q"><div class="dist-q-title">' + esc(f.label) + '（已填 ' + vals.length + ' 人）</div><div class="dist-row"><div class="dist-name"></div><div class="dist-val" style="width:auto;text-align:left">' + esc(vals.slice(0, 12).join('、')) + (vals.length > 12 ? ' …' : '') + '</div></div></div>');
    });
    box.innerHTML = parts.length ? parts.join('') : '<div class="empty">暂无可统计的选项题</div>';
  }
  function renderFilterOptions() {
    var sel = $('filterField');
    var old = sel.value;
    sel.innerHTML = '<option value="">全部字段</option>' + cfg.fields.map(function (f) {
      return '<option value="' + esc(f.id) + '">' + esc(fieldLabel(f.id)) + '</option>';
    }).join('');
    if (old && cfg.fields.some(function (f) { return f.id === old; })) sel.value = old;
    updateFilterValues();
  }
  function updateFilterValues() {
    var fid = $('filterField').value, sel = $('filterValue');
    var f = cfg.fields.find(function (x) { return x.id === fid; });
    var vals = [];
    if (f && f.options) vals = f.options;
    else if (f) {
      var set = {};
      adminEntries.forEach(function (e) { var v = e.data && e.data[f.id]; if (v) set[String(v)] = 1; });
      vals = Object.keys(set);
    }
    sel.innerHTML = '<option value="">不限</option>' + vals.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }
  function filtered() {
    var kw = ($('searchBox').value || '').trim().toLowerCase();
    var fid = $('filterField').value, fv = $('filterValue').value;
    return adminEntries.filter(function (e) {
      if (fid && fv) {
        var v = e.data && e.data[fid];
        var hit = Array.isArray(v) ? v.indexOf(fv) >= 0 : String(v || '') === fv;
        if (!hit) return false;
      }
      if (kw) {
        var all = JSON.stringify(e.data || {}).toLowerCase();
        if (all.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }
  function renderTable() {
    var rows = filtered();
    var thead = '<tr><th>#</th>' + cfg.fields.map(function (f) { return '<th>' + esc(fieldLabel(f.id)) + '</th>'; }).join('') + '<th>提交时间</th><th>操作</th></tr>';
    var tbody = rows.length ? rows.map(function (e, i) {
      return '<tr><td>' + (i + 1) + '</td>' + cfg.fields.map(function (f) {
        return '<td>' + esc(cellVal(f, e.data && e.data[f.id])) + '</td>';
      }).join('') + '<td>' + esc(bj(e.updatedAt, false)) + '</td>' +
        '<td><span class="del-row" data-cid="' + esc(e.cid) + '">删除</span></td></tr>';
    }).join('') : '<tr><td colspan="' + (cfg.fields.length + 3) + '" class="empty">暂无提交数据</td></tr>';
    document.querySelector('#entryTable thead').innerHTML = thead;
    document.querySelector('#entryTable tbody').innerHTML = tbody;
    $('listCount').textContent = '显示 ' + rows.length + ' / ' + adminEntries.length + ' 条';
    document.querySelectorAll('.del-row').forEach(function (el) {
      el.addEventListener('click', function () {
        var cid = el.getAttribute('data-cid');
        if (!confirm('确定删除这条接龙记录？不可恢复。')) return;
        post('clear', { act: curAct, passcode: getPass(), cid: cid }).then(function () { toast('已删除'); refreshAdmin(); })
          .catch(function (e) { toast('删除失败：' + e.message); });
      });
    });
  }

  function exportCsv() {
    var rows = filtered();
    if (!rows.length) { toast('没有可导出的数据'); return; }
    var head = ['序号'].concat(cfg.fields.map(function (f) { return f.label; })).concat(['提交时间']);
    function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    var lines = [head.map(q).join(',')];
    rows.forEach(function (e, i) {
      lines.push([i + 1].concat(cfg.fields.map(function (f) { return cellVal(f, e.data && e.data[f.id]); })).concat([bj(e.updatedAt, false)]).map(q).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (cfg.title || '接龙') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出 ' + rows.length + ' 条');
  }

  /* ---------- 活动配置编辑 ---------- */
  function fillConfigEditor() {
    $('cfgTitle').value = cfg.title || '';
    $('cfgNotice').value = cfg.notice || '';
    $('cfgActId').value = cfg.id || curAct;
    $('cfgDeadline').value = isoToBjLocal(cfg.deadline);
    renderFieldEditor();
  }
  function renderFieldEditor() {
    var box = $('fieldEditor');
    box.innerHTML = cfg.fields.map(function (f, i) {
      var typeSel = '<select class="fe-type" data-i="' + i + '">' +
        [['text', '填空'], ['number', '数字'], ['radio', '单选'], ['checkbox', '多选']].map(function (t) {
          return '<option value="' + t[0] + '"' + (f.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('') + '</select>';
      var opts = '';
      if (f.type === 'radio' || f.type === 'checkbox') {
        var chips = (f.options || []).map(function (o, oi) {
          return '<span class="opt-chip">' + esc(o) + '<span class="x" data-i="' + i + '" data-oi="' + oi + '">×</span></span>';
        }).join('');
        opts = '<div class="fe-opts">' + chips + '<input class="new-opt" data-i="' + i + '" placeholder="输入选项后回车" />' +
          '<span class="hint">回车添加选项</span></div>';
      }
      var extra = '';
      if (isTextLike(f)) {
        extra = '<div class="fe-extras"><label class="fe-extra">提示文字<input type="text" class="fe-placeholder" data-i="' + i + '" value="' + esc(f.placeholder || '') + '" placeholder="如：请输入游戏昵称" /></label>';
        if (f.type === 'number') {
          extra += '<label class="fe-extra short">最小值<input type="number" class="fe-min" data-i="' + i + '" value="' + esc(f.min == null ? '' : f.min) + '" placeholder="不限" /></label>' +
            '<label class="fe-extra short">最大值<input type="number" class="fe-max" data-i="' + i + '" value="' + esc(f.max == null ? '' : f.max) + '" placeholder="不限" /></label>';
        }
        extra += '</div>';
      }
      return '<div class="fe-item"><div class="fe-head"><span class="fe-num">Q' + (i + 1) + '</span>' +
        '<input type="text" class="fe-label" data-i="' + i + '" value="' + esc(f.label) + '" placeholder="题目标题" />' +
        typeSel + '<span class="fe-del" data-i="' + i + '">删除</span></div>' + opts + extra +
        '<label class="fe-check"><input type="checkbox" class="fe-req" data-i="' + i + '"' + (f.required ? ' checked' : '') + ' />必填</label></div>';
    }).join('');

    box.querySelectorAll('.fe-label').forEach(function (el) {
      el.addEventListener('input', function () { cfg.fields[+el.dataset.i].label = el.value; });
    });
    box.querySelectorAll('.fe-type').forEach(function (el) {
      el.addEventListener('change', function () {
        var f = cfg.fields[+el.dataset.i];
        f.type = el.value;
        if ((f.type === 'radio' || f.type === 'checkbox') && (!f.options || !f.options.length)) f.options = ['选项1', '选项2'];
        if (isTextLike(f) && f.placeholder === undefined) f.placeholder = '';
        renderFieldEditor();
      });
    });
    ['placeholder', 'min', 'max'].forEach(function (prop) {
      box.querySelectorAll('.fe-' + prop).forEach(function (el) {
        el.addEventListener('input', function () { cfg.fields[+el.dataset.i][prop] = el.value.trim(); });
      });
    });
    box.querySelectorAll('.fe-req').forEach(function (el) {
      el.addEventListener('change', function () { cfg.fields[+el.dataset.i].required = el.checked; });
    });
    box.querySelectorAll('.fe-del').forEach(function (el) {
      el.addEventListener('click', function () { cfg.fields.splice(+el.dataset.i, 1); renderFieldEditor(); });
    });
    box.querySelectorAll('.x').forEach(function (el) {
      el.addEventListener('click', function () { cfg.fields[+el.dataset.i].options.splice(+el.dataset.oi, 1); renderFieldEditor(); });
    });
    box.querySelectorAll('.new-opt').forEach(function (el) {
      el.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        var v = el.value.trim(); if (!v) return;
        cfg.fields[+el.dataset.i].options.push(v); renderFieldEditor();
      });
    });
  }
  function saveConfig() {
    var newId = ($('cfgActId').value || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
    if (!newId) { toast('请填写合法的活动 ID'); return; }
    var dl = ($('cfgDeadline').value || '').trim();
    var payload = {
      title: $('cfgTitle').value.trim() || newId,
      notice: $('cfgNotice').value.trim(),
      deadline: bjLocalToISO(dl),
      fields: cfg.fields.map(function (f) {
        var o = { id: f.id, label: f.label || '未命名题目', type: f.type, required: !!f.required };
        o.placeholder = f.placeholder || '';
        if (f.type === 'radio' || f.type === 'checkbox') o.options = f.options || [];
        if (f.type === 'number') { o.min = f.min || ''; o.max = f.max || ''; }
        return o;
      })
    };
    var btn = $('btnSaveConfig'); btn.disabled = true;
    // 保存走当前 curAct 的 key；若改了 ID，则视为新活动（旧活动数据不迁移）
    post('config-save', { act: newId, passcode: getPass(), config: payload }).then(function () {
      curAct = newId;
      try { localStorage.setItem('chain.lastAct', newId); } catch (e) {}
      acts = acts.filter(function (a) { return a.id !== newId; });
      acts.push({ id: newId, title: payload.title });
      cfg = Object.assign({ id: newId }, payload);
      renderList(); fillConfigEditor(); renderDeadline();
      $('cfgSavedHint').textContent = '✅ 已保存并发布 · ' + bj(new Date().toISOString(), false);
      toast('活动已保存并发布');
    }).catch(function (e) { toast('保存失败：' + e.message); })
      .finally(function () { btn.disabled = false; });
  }

  /* 新建空白接龙：生成新 ID 与一份示例题目，保存后即成为独立接龙 */
  function newActivity() {
    var stamp = Date.now().toString(36);
    $('cfgActId').value = 'act' + stamp;
    $('cfgTitle').value = '新接龙 ' + bj(new Date().toISOString(), false).slice(5, 10);
    $('cfgNotice').value = '发布人已设置填写的内容不会被其他人查看，保护隐私';
    $('cfgDeadline').value = '';
    cfg.fields = [{ id: 'f' + stamp, label: '游戏昵称', type: 'text', required: true, placeholder: '请输入游戏昵称' }];
    renderFieldEditor();
    $('cfgSavedHint').textContent = '🆕 新接龙草稿，请修改题目后点「保存并发布活动」';
    toast('已新建空白接龙草稿');
    $('cfgTitle').focus(); $('cfgTitle').select();
  }

  /* 复制当前接龙为新活动：沿用全部题目配置（含编辑器里的未保存修改），但不复制已提交名单 */
  function copyActivity() {
    if (!cfg || !cfg.fields) { toast('请先加载活动配置'); return; }
    var base = (cfg.id || curAct).replace(/_copy[0-9a-z]+$/, '');
    var newId = (base + '_copy' + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    var curTitle = $('cfgTitle').value.trim() || cfg.title || curAct;
    $('cfgActId').value = newId;
    $('cfgTitle').value = curTitle + '（副本）';
    $('cfgSavedHint').textContent = '📋 已复制配置，请确认名称/ID/截止日期后点「保存并发布活动」（名单不复制）';
    toast('已复制为新接龙草稿，保存后生效');
    $('cfgTitle').focus(); $('cfgTitle').select();
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('btnBackList').addEventListener('click', goList);
    $('btnBackListAdmin').addEventListener('click', goList);
    $('btnDraft').addEventListener('click', saveDraft);
    $('fillForm').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    $('btnCopyLink').addEventListener('click', function () {
      var url = location.origin + location.pathname + '?act=' + encodeURIComponent(curAct) + '&view=fill';
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('填写链接已复制'); }).catch(function () { prompt('复制此链接：', url); });
      else prompt('复制此链接：', url);
    });
    $('btnRefresh').addEventListener('click', function () {
      loadActs().then(function () {
        if (curView === 'list') renderList();
        else if (curView === 'admin') refreshAdmin();
        else loadConfig();
        toast('已刷新');
      });
    });
    $('btnAdmin').addEventListener('click', function () { openAdmin(curAct); });
    $('btnUnlock').addEventListener('click', unlock);
    $('adminPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
    $('btnLock').addEventListener('click', function () { setPass(''); adminUnlocked = false; $('adminBody').hidden = true; $('lockCard').hidden = false; toast('已退出管理'); });
    document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); }); });
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('searchBox').addEventListener('input', renderTable);
    $('filterField').addEventListener('change', function () { updateFilterValues(); renderTable(); });
    $('filterValue').addEventListener('change', renderTable);
    $('btnClearFilter').addEventListener('click', function () { $('searchBox').value = ''; $('filterField').value = ''; $('filterValue').value = ''; updateFilterValues(); renderTable(); });
    $('btnClearAll').addEventListener('click', function () {
      if (!confirm('⚠️ 将清空「' + (cfg.title || curAct) + '」的全部接龙记录，不可恢复。确定继续？')) return;
      post('clear', { act: curAct, passcode: getPass() }).then(function (r) { toast('已清空 ' + (r.removed || 0) + ' 条'); refreshAdmin(); })
        .catch(function (e) { toast('清空失败：' + e.message); });
    });
    $('btnAddField').addEventListener('click', function () {
      cfg.fields.push({ id: 'f' + (Date.now().toString(36)), label: '新题目', type: 'text', required: false, placeholder: '' });
      renderFieldEditor();
    });
    $('btnCopyAct').addEventListener('click', copyActivity);
    $('btnNewAct').addEventListener('click', newActivity);
    $('btnSaveConfig').addEventListener('click', saveConfig);
  }

  async function init() {
    bind();
    await loadActs();
    var params = new URLSearchParams(location.search);
    var urlAct = params.get('act'), view = params.get('view');
    if (urlAct && view !== 'list') {
      /* 兼容旧链接：只有 act 没有 view 时，默认直达填写页 */
      if (!acts.some(function (a) { return a.id === urlAct; })) acts.push({ id: urlAct, title: urlAct });
      if (view === 'admin') await openAdmin(urlAct);
      else await openFill(urlAct);
    } else {
      showView('list');
      renderList();
    }
    $('stats').textContent = '成员自助填写 · 隐私隔离 · 后台统计导出';
  }
  init();
})();
