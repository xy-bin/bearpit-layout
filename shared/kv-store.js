/* Cloudflare KV 同源存取（/api/data，Worker 服务端校验口令）
   纯静态双击 file:// 打开时自动降级为纯本地（localStorage），无网络请求 */
(function () {
  'use strict';
  var PASS_KEY = 'kv.admin.pass';

  function ok() { return location.protocol === 'http:' || location.protocol === 'https:'; }

  /* 口令持久化到 localStorage：刷新页面、换标签页、重开浏览器都保持解锁态。
     旧版存在 sessionStorage，这里做一次平滑迁移。 */
  function getPass() {
    try {
      var p = localStorage.getItem(PASS_KEY);
      if (p) return p;
      var old = sessionStorage.getItem(PASS_KEY);
      if (old) { try { localStorage.setItem(PASS_KEY, old); } catch (e2) { /* 忽略 */ } return old; }
    } catch (e) { /* 存储不可用时忽略 */ }
    return '';
  }
  function setPass(p) {
    try {
      if (p) {
        localStorage.setItem(PASS_KEY, p);
        sessionStorage.setItem(PASS_KEY, p);
      } else {
        localStorage.removeItem(PASS_KEY);
        sessionStorage.removeItem(PASS_KEY);
      }
    } catch (e) { /* 忽略 */ }
  }

  /* 读：{ payload, updated_at } 或 null */
  async function load(key) {
    var r = await fetch('/api/data?key=' + encodeURIComponent(key) + '&t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('KV_LOAD_FAILED');
    return await r.json();
  }

  /* 写：需口令，服务端校验 */
  async function save(key, payload, pass) {
    var r = await fetch('/api/data', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: key, payload: payload, passcode: pass })
    });
    var j = null;
    try { j = await r.json(); } catch (e) { /* 忽略 */ }
    if (!r.ok) throw new Error((j && j.error) || ('KV_SAVE_FAILED_' + r.status));
    return j;
  }

  /* 口令校验（解锁时用） */
  async function check(pass) {
    var r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode: pass })
    });
    if (!r.ok) throw new Error('KV_CHECK_FAILED_' + r.status);
    var j = await r.json();
    return !!j.ok;
  }

  window.KVStore = { ok: ok, load: load, save: save, check: check, getPass: getPass, setPass: setPass };
})();

/* 云端存的是 UTC（ISO 8601，带 Z）。统一转成北京时间显示，避免把 22:34Z 误看成「昨天」。
   withAgo=true 时附带「x 分钟前」，方便一眼判断数据新旧。 */
window.fmtKVTime = function (s, withAgo) {
  if (!s) return '未知时间';
  var d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  var t = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  function p(n) { return n < 10 ? '0' + n : String(n); }
  var text = t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' +
    p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds()) + '（北京时间）';
  if (!withAgo) return text;
  var diff = Date.now() - d.getTime();
  var ago = diff < 0 ? '刚刚' :
    diff < 60000 ? Math.floor(diff / 1000) + ' 秒前' :
    diff < 3600000 ? Math.floor(diff / 60000) + ' 分钟前' :
    diff < 86400000 ? Math.floor(diff / 3600000) + ' 小时前' :
    Math.floor(diff / 86400000) + ' 天前';
  return text + '，' + ago;
};

/* 云端同步器：boot 拉取、push 防抖上传、publish 立即上传、viewer 轮询；由各工具传入 collect/apply 钩子 */
window.makeKVSync = function (cfg) {
  var timer = null, lastUpdatedAt = null, polling = false, dirty = false;
  var DEBOUNCE = cfg.debounceMs || 1200, POLL = cfg.pollMs || 30000;

  function status(t) { if (cfg.onStatus) try { cfg.onStatus(t); } catch (e) { /* 忽略 */ } }
  function pass() { return window.KVStore ? KVStore.getPass() : ''; }
  function ready() { return window.KVStore && KVStore.ok(); }
  function when(s, ago) { return window.fmtKVTime ? fmtKVTime(s, ago) : (s || '未知时间'); }

  /* 启动：KV 有数据则应用（云端为准），返回远端行或 null */
  async function boot() {
    if (!ready()) return null;
    try {
      var row = await KVStore.load(cfg.key);
      if (row && row.payload) {
        lastUpdatedAt = row.updated_at;
        cfg.apply(row.payload);
        dirty = false;
        status((pass() ? '云端已同步 ' : '云端实时数据 · ') + when(lastUpdatedAt, true));
        return row;
      }
      status('云端暂无数据（解锁后修改会上传）');
    } catch (e) { status('云端连接失败'); }
    return null;
  }

  /* 防抖上传（仅解锁后生效）；未解锁时标记本地有改动，避免轮询把编辑覆盖掉 */
  function push() {
    if (!ready()) return;
    if (!pass()) { dirty = true; return; }
    if (timer) return;
    timer = setTimeout(async function () {
      timer = null;
      try {
        var r = await KVStore.save(cfg.key, cfg.collect(), pass());
        if (r && r.updated_at) lastUpdatedAt = r.updated_at;
        dirty = false;
        status('已同步 ' + when(lastUpdatedAt, true));
      } catch (e) {
        var msg = String((e && e.message) || e);
        if (msg.indexOf('INVALID_PASSCODE') >= 0) {
          KVStore.setPass('');
          status('口令已失效，请重新解锁');
          if (cfg.onLockExpired) try { cfg.onLockExpired(); } catch (e2) { /* 忽略 */ }
        } else status('同步失败：' + msg);
      }
    }, DEBOUNCE);
  }

  /* 立即发布：不走防抖，把当前页面内容强制写入云端 */
  async function publish() {
    if (!ready()) throw new Error('云端不可用（本地打开或网络受限）');
    var p = pass();
    if (!p) throw new Error('请先点 🔒 管理员解锁');
    var r = await KVStore.save(cfg.key, cfg.collect(), p);
    if (r && r.updated_at) lastUpdatedAt = r.updated_at;
    dirty = false;
    status('已发布到云端 ' + when(lastUpdatedAt, true));
    return r;
  }

  /* 观察者轮询：未解锁且本地无未上传改动时，自动应用云端最新 */
  function startPolling() {
    if (!ready() || polling) return;
    polling = true;
    setInterval(async function () {
      if (timer || pass() || dirty) return;
      try {
        var row = await KVStore.load(cfg.key);
        if (row && row.payload && row.updated_at && row.updated_at !== lastUpdatedAt) {
          lastUpdatedAt = row.updated_at;
          cfg.apply(row.payload);
          status('云端已更新 · ' + when(lastUpdatedAt, true));
        }
      } catch (e) { /* 轮询失败静默 */ }
    }, POLL);
  }

  async function unlock(p) {
    if (!ready()) throw new Error('云端不可用（本地打开或网络受限）');
    var okp = await KVStore.check(p);
    if (okp) { KVStore.setPass(p); dirty = false; status('已解锁，修改将实时同步'); }
    return okp;
  }

  return {
    boot: boot, push: push, publish: publish, unlock: unlock,
    isUnlocked: function () { return !!pass(); },
    lastSync: function () { return lastUpdatedAt; },
    startPolling: startPolling
  };
};

/* 通用启动：同步按钮初始状态 → 拉云端 → 云端为空且已解锁时把本地数据初始化上去 → 开启轮询 */
window.initCloudSync = function (sync, cloudBtn, onBoot) {
  if (!sync) return;
  if (cloudBtn && sync.isUnlocked()) cloudBtn.textContent = '🔓 已解锁';
  sync.boot().then(function (row) {
    if (onBoot) { try { onBoot(row); } catch (e) { /* 忽略 */ } }
    if (!row && sync.isUnlocked()) return sync.publish().catch(function () { /* 静默 */ });
  }).catch(function () { /* 静默 */ });
  sync.startPolling();
};

/* 通用「☁ 发布」按钮：未解锁时顺带弹口令框，解锁后立即把当前内容写入云端 */
window.bindPublishButton = function (sync, btn, cloudBtn) {
  if (!sync || !btn) return;
  btn.addEventListener('click', async function () {
    if (!KVStore.ok()) { alert('云端不可用：请通过 https://wjdr.xybin.top 打开（本地 file:// 无法同步）'); return; }
    if (!sync.isUnlocked()) {
      var p = prompt('输入管理口令以发布到云端');
      if (!p) return;
      btn.disabled = true;
      try {
        var good = await sync.unlock(p);
        if (!good) { alert('口令不正确'); btn.disabled = false; return; }
        if (cloudBtn) cloudBtn.textContent = '🔓 已解锁';
      } catch (e) {
        alert('解锁失败：' + String((e && e.message) || e));
        btn.disabled = false;
        return;
      }
    }
    btn.disabled = true;
    btn.textContent = '发布中…';
    try {
      var r = await sync.publish();
      alert('已发布到云端 ✅\n更新时间：' + window.fmtKVTime(r && r.updated_at, true) + '\n盟友刷新页面即可看到。');
    } catch (e) {
      var msg = String((e && e.message) || e);
      if (msg.indexOf('INVALID_PASSCODE') >= 0) { KVStore.setPass(''); if (cloudBtn) cloudBtn.textContent = '🔒 管理员'; }
      alert('发布失败：' + msg);
    }
    btn.textContent = '☁ 发布';
    btn.disabled = false;
  });
};
