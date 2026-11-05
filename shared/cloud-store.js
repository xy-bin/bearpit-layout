/* 云端数据存取：公开读 + 口令写（服务端 SECURITY DEFINER 函数校验口令）
   依赖：cloud-config.js 先加载；WorkBuddyCloud 为 CDN SDK 全局变量 */
(function () {
  'use strict';
  var PASS_KEY = 'wb.admin.pass';
  var client = null;

  function ok() { return !!(window.WorkBuddyCloud && window.WB_APP_CONFIG && window.WB_APP_CONFIG.endpoint); }
  function getClient() {
    if (!client) {
      client = WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: window.WB_APP_CONFIG.endpoint,
        publishableKey: window.WB_APP_CONFIG.publishableKey
      });
    }
    return client;
  }
  function getPass() { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  function setPass(p) {
    try { p ? sessionStorage.setItem(PASS_KEY, p) : sessionStorage.removeItem(PASS_KEY); } catch (e) { /* 忽略 */ }
  }

  async function load(key) {
    var r = await getClient().database.from('tool_data').select('payload,updated_at').eq('key', key).maybeSingle();
    if (r.error) throw r.error;
    return r.data; /* { payload, updated_at } 或 null */
  }
  async function save(key, payload, pass) {
    var r = await getClient().database.rpc('save_tool_data', { p_key: key, p_payload: payload, p_passcode: pass });
    if (r.error) throw r.error;
    return r.data;
  }
  async function check(pass) {
    var r = await getClient().database.rpc('check_passcode', { p_passcode: pass });
    if (r.error) throw r.error;
    return !!r.data;
  }

  window.CloudStore = { ok: ok, load: load, save: save, check: check, getPass: getPass, setPass: setPass, available: ok() };
})();

/* 云端同步器：boot 拉取、push 防抖上传、viewer 轮询；由各工具传入 collect/apply 钩子 */
window.makeCloudSync = function (cfg) {
  var timer = null, lastUpdatedAt = null, polling = false;
  var DEBOUNCE = cfg.debounceMs || 1200, POLL = cfg.pollMs || 30000;

  function status(t) { if (cfg.onStatus) try { cfg.onStatus(t); } catch (e) { /* 忽略 */ } }
  function pass() { return window.CloudStore ? window.CloudStore.getPass() : ''; }
  function cloudReady() { return window.CloudStore && window.CloudStore.ok(); }

  /* 启动：云端有数据则应用（云端为准），返回远端行或 null */
  async function boot() {
    if (!cloudReady()) return null;
    try {
      var row = await CloudStore.load(cfg.key);
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
    if (!cloudReady() || !pass()) return;
    if (timer) return;
    timer = setTimeout(async function () {
      timer = null;
      try {
        var r = await CloudStore.save(cfg.key, cfg.collect(), pass());
        if (r && r.updated_at) lastUpdatedAt = r.updated_at;
        status('已同步 ' + lastUpdatedAt);
      } catch (e) {
        var msg = String((e && e.message) || e);
        if (msg.indexOf('INVALID_PASSCODE') >= 0) {
          CloudStore.setPass('');
          status('口令已失效，请重新解锁');
          if (cfg.onLockExpired) try { cfg.onLockExpired(); } catch (e2) { /* 忽略 */ }
        } else status('同步失败，稍后重试');
      }
    }, DEBOUNCE);
  }

  /* 观察者轮询：未解锁时自动应用云端最新（解锁者跳过，避免覆盖正在编辑的内容） */
  function startPolling() {
    if (!cloudReady() || polling) return;
    polling = true;
    setInterval(async function () {
      if (timer || pass()) return; /* 有待上传或处于编辑态时不拉取 */
      try {
        var row = await CloudStore.load(cfg.key);
        if (row && row.payload && row.updated_at && row.updated_at !== lastUpdatedAt) {
          lastUpdatedAt = row.updated_at;
          cfg.apply(row.payload);
          status('云端已更新 · ' + lastUpdatedAt);
        }
      } catch (e) { /* 轮询失败静默 */ }
    }, POLL);
  }

  async function unlock(p) {
    if (!cloudReady()) throw new Error('云端不可用（本地打开或网络受限）');
    var okp = await CloudStore.check(p);
    if (okp) { CloudStore.setPass(p); status('已解锁，修改将实时同步'); }
    return okp;
  }

  return { boot: boot, push: push, unlock: unlock, isUnlocked: function () { return !!pass(); }, startPolling: startPolling };
};
