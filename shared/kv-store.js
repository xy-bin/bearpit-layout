/* Cloudflare KV 同源存取（/api/data，Pages Function 服务端校验口令）
   纯静态双击 file:// 打开时自动降级为纯本地（localStorage），无网络请求 */
(function () {
  'use strict';
  var PASS_KEY = 'kv.admin.pass';

  function ok() { return location.protocol === 'http:' || location.protocol === 'https:'; }
  function getPass() { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  function setPass(p) {
    try { p ? sessionStorage.setItem(PASS_KEY, p) : sessionStorage.removeItem(PASS_KEY); } catch (e) { /* 忽略 */ }
  }

  /* 读：{ payload, updated_at } 或 null */
  async function load(key) {
    var r = await fetch('api/data?key=' + encodeURIComponent(key) + '&t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('KV_LOAD_FAILED');
    return await r.json();
  }

  /* 写：需口令，服务端校验 */
  async function save(key, payload, pass) {
    var r = await fetch('api/data', {
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
    var r = await fetch('api/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode: pass })
    });
    if (!r.ok) throw new Error('KV_CHECK_FAILED');
    var j = await r.json();
    return !!j.ok;
  }

  window.KVStore = { ok: ok, load: load, save: save, check: check, getPass: getPass, setPass: setPass };
})();

/* 云端同步器：boot 拉取、push 防抖上传、viewer 轮询；由各工具传入 collect/apply 钩子 */
window.makeKVSync = function (cfg) {
  var timer = null, lastUpdatedAt = null, polling = false;
  var DEBOUNCE = cfg.debounceMs || 1200, POLL = cfg.pollMs || 30000;

  function status(t) { if (cfg.onStatus) try { cfg.onStatus(t); } catch (e) { /* 忽略 */ } }
  function pass() { return window.KVStore ? KVStore.getPass() : ''; }
  function ready() { return window.KVStore && KVStore.ok(); }

  /* 启动：KV 有数据则应用（云端为准），返回远端行或 null */
  async function boot() {
    if (!ready()) return null;
    try {
      var row = await KVStore.load(cfg.key);
      if (row && row.payload) {
        lastUpdatedAt = row.updated_at;
        cfg.apply(row.payload);
        status(pass() ? '云端已同步 ' + lastUpdatedAt : '云端实时数据 · ' + lastUpdatedAt);
        return row;
      }
      status('云端暂无数据（解锁后修改会上传）');
    } catch (e) { status('云端连接失败'); }
    return null;
  }

  /* 防抖上传（仅解锁后生效） */
  function push() {
    if (!ready() || !pass()) return;
    if (timer) return;
    timer = setTimeout(async function () {
      timer = null;
      try {
        var r = await KVStore.save(cfg.key, cfg.collect(), pass());
        if (r && r.updated_at) lastUpdatedAt = r.updated_at;
        status('已同步 ' + lastUpdatedAt);
      } catch (e) {
        var msg = String((e && e.message) || e);
        if (msg.indexOf('INVALID_PASSCODE') >= 0) {
          KVStore.setPass('');
          status('口令已失效，请重新解锁');
          if (cfg.onLockExpired) try { cfg.onLockExpired(); } catch (e2) { /* 忽略 */ }
        } else status('同步失败，稍后重试');
      }
    }, DEBOUNCE);
  }

  /* 观察者轮询：未解锁时自动应用云端最新（解锁者跳过，避免覆盖正在编辑的内容） */
  function startPolling() {
    if (!ready() || polling) return;
    polling = true;
    setInterval(async function () {
      if (timer || pass()) return; /* 有待上传或处于编辑态时不拉取 */
      try {
        var row = await KVStore.load(cfg.key);
        if (row && row.payload && row.updated_at && row.updated_at !== lastUpdatedAt) {
          lastUpdatedAt = row.updated_at;
          cfg.apply(row.payload);
          status('云端已更新 · ' + lastUpdatedAt);
        }
      } catch (e) { /* 轮询失败静默 */ }
    }, POLL);
  }

  async function unlock(p) {
    if (!ready()) throw new Error('云端不可用（本地打开或网络受限）');
    var okp = await KVStore.check(p);
    if (okp) { KVStore.setPass(p); status('已解锁，修改将实时同步'); }
    return okp;
  }

  return { boot: boot, push: push, unlock: unlock, isUnlocked: function () { return !!pass(); }, startPolling: startPolling };
};
