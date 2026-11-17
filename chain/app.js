/* 接龙收集 · 前端逻辑
   - 成员端：公开读配置/活动列表，匿名提交（cid 隔离，仅能读/改自己那条），草稿存本地
   - 后台端：口令解锁（服务端校验），名单统计、筛选删除、CSV 导出、活动配置 */
(function () {
  'use strict';

  var PASS_KEY = 'kv.admin.pass';
  var acts = [], curAct = '', cfg = null, myEntry = null;
  var adminEntries = [], adminUnlocked = false, curTab = 'data';
  var drafts = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  function setPass(p) {
    try { if (p) localStorage.setItem(PASS_KEY, p); else localStorage.removeItem(PASS_KEY); } catch (e) {}
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

  /* ---------- 活动与表单 ---------- */
  async function loadActs() {
    var remote = null;
    try { remote = (await api('acts')).acts; } catch (e) {}
    acts = (remote && remote.length) ? remote : (window.CHAIN_DEFAULT_ACTS || []).map(function (a) { return { id: a.id, title: a.title }; });
    var urlAct = new URLSearchParams(location.search).get('act');
    var saved = null; try { saved = localStorage.getItem('chain.lastAct'); } catch (e) {}
    curAct = urlAct || saved || (acts[0] && acts[0].id) || 'default';
    if (!acts.some(function (a) { return a.id === curAct; })) acts.push({ id: curAct, title: curAct });
    renderActSelect();
  }
  function renderActSelect() {
    var sel = $('actSelect');
    sel.innerHTML = acts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === curAct ? ' selected' : '') + '>' + esc(a.title || a.id) + '</option>'; }).join('');
    $('actMeta').innerHTML = '<span class="pill">共 ' + acts.length + ' 个接龙</span>';
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
      var tag = f.type === 'checkbox' ? '可多选' : f.type === 'radio' ? '单选' : '填空';
      var ctrl = '';
      if (f.type === 'text' || f.type === 'textarea') {
        ctrl = '<input class="q-input" type="text" data-fid="' + esc(f.id) + '" placeholder="' + esc(f.placeholder || '') + '" />';
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
  }
  function readForm() {
    var data = {};
    cfg.fields.forEach(function (f) {
      if (f.type === 'text' || f.type === 'textarea') {
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
      if (f.type === 'text' || f.type === 'textarea') {
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
    } catch (e) { toast('提交失败：' + e.message); }
    btn.disabled = false; btn.textContent = '提交';
  }

  /* ---------- 后台 ---------- */
  function showAdmin(on) {
    $('pageFill').hidden = on;
    $('pageAdmin').hidden = !on;
    if (on && adminUnlocked) { $('lockCard').hidden = true; $('adminBody').hidden = false; }
  }
  async function unlock() {
    var p = $('adminPass').value.trim();
    if (!p) { $('lockErr').textContent = '请输入口令'; $('lockErr').hidden = false; return; }
    $('lockErr').hidden = true;
    try {
      var r = await post('admin', { act: curAct, passcode: p });
      setPass(p); adminUnlocked = true;
      adminEntries = r.entries || [];
      if (r.acts && r.acts.length) { acts = r.acts; renderActSelect(); }
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
      if (f.type === 'text' || f.type === 'textarea' || !f.options || !f.options.length) return;
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
      if (f.type !== 'text' && f.type !== 'textarea') return;
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
    renderFieldEditor();
  }
  function renderFieldEditor() {
    var box = $('fieldEditor');
    box.innerHTML = cfg.fields.map(function (f, i) {
      var typeSel = '<select class="fe-type" data-i="' + i + '">' +
        [['text', '填空'], ['radio', '单选'], ['checkbox', '多选']].map(function (t) {
          return '<option value="' + t[0] + '"' + (f.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('') + '</select>';
      var opts = '';
      if (f.type !== 'text') {
        var chips = (f.options || []).map(function (o, oi) {
          return '<span class="opt-chip">' + esc(o) + '<span class="x" data-i="' + i + '" data-oi="' + oi + '">×</span></span>';
        }).join('');
        opts = '<div class="fe-opts">' + chips + '<input class="new-opt" data-i="' + i + '" placeholder="输入选项后回车" />' +
          '<span class="hint">回车添加选项</span></div>';
      }
      return '<div class="fe-item"><div class="fe-head"><span class="fe-num">Q' + (i + 1) + '</span>' +
        '<input type="text" class="fe-label" data-i="' + i + '" value="' + esc(f.label) + '" placeholder="题目标题" />' +
        typeSel + '<span class="fe-del" data-i="' + i + '">删除</span></div>' + opts +
        '<label class="fe-check"><input type="checkbox" class="fe-req" data-i="' + i + '"' + (f.required ? ' checked' : '') + ' />必填</label></div>';
    }).join('');

    box.querySelectorAll('.fe-label').forEach(function (el) {
      el.addEventListener('input', function () { cfg.fields[+el.dataset.i].label = el.value; });
    });
    box.querySelectorAll('.fe-type').forEach(function (el) {
      el.addEventListener('change', function () {
        var f = cfg.fields[+el.dataset.i];
        f.type = el.value;
        if (!f.options || !f.options.length) f.options = ['选项1', '选项2'];
        renderFieldEditor();
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
    var payload = {
      title: $('cfgTitle').value.trim() || newId,
      notice: $('cfgNotice').value.trim(),
      fields: cfg.fields.map(function (f) {
        var o = { id: f.id, label: f.label || '未命名题目', type: f.type, required: !!f.required };
        if (f.type !== 'text') o.options = f.options || [];
        o.placeholder = f.placeholder || '';
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
      renderActSelect(); fillConfigEditor();
      $('cfgSavedHint').textContent = '✅ 已保存并发布 · ' + bj(new Date().toISOString(), false);
      toast('活动已保存并发布');
    }).catch(function (e) { toast('保存失败：' + e.message); })
      .finally(function () { btn.disabled = false; });
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('actSelect').addEventListener('change', function () {
      curAct = this.value;
      try { localStorage.setItem('chain.lastAct', curAct); } catch (e) {}
      history.replaceState(null, '', location.pathname + '?act=' + encodeURIComponent(curAct));
      loadConfig();
      if (adminUnlocked) { refreshAdmin(); fillConfigEditor(); }
    });
    $('btnDraft').addEventListener('click', saveDraft);
    $('fillForm').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    $('btnCopyLink').addEventListener('click', function () {
      var url = location.origin + location.pathname + '?act=' + encodeURIComponent(curAct);
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('填写链接已复制'); }).catch(function () { prompt('复制此链接：', url); });
      else prompt('复制此链接：', url);
    });
    $('btnRefresh').addEventListener('click', function () { loadActs().then(loadConfig).then(function () { toast('已刷新'); }); });
    $('btnAdmin').addEventListener('click', function () {
      if (adminUnlocked) { showAdmin(true); }
      else { $('adminPass').value = getPass(); showAdmin(true); }
    });
    $('btnUnlock').addEventListener('click', unlock);
    $('adminPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
    $('btnLock').addEventListener('click', function () { setPass(''); adminUnlocked = false; $('adminBody').hidden = true; $('lockCard').hidden = false; showAdmin(false); toast('已退出管理'); });
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
    $('btnSaveConfig').addEventListener('click', saveConfig);
  }

  async function init() {
    bind();
    await loadActs();
    await loadConfig();
    $('stats').textContent = '成员自助填写 · 隐私隔离 · 后台统计导出';
    // 后台若已有解锁口令，进入后台页时自动恢复（不主动解锁，点后台按钮时用已存口令尝试）
  }
  init();
})();
