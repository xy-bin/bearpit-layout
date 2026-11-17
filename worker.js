/* Worker 入口：/api/data 接口 + 其余走静态资源
   KV 绑定变量名：KV_DATA（在 Cloudflare 仪表盘 → Settings → Bindings 添加） */
const ADMIN_HASH = 'bf92f9e2d48fb5736be14487efbd9bcb9d12ae783a6d8a6e7097457ab3b00a5b'; /* sha256('wbs1:' + 管理口令) */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function validKey(k) {
  return typeof k === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(k);
}

/* ============ 接龙（收集表）专用接口 ============
   - 成员匿名提交：每人一条独立 KV key（csub:<act>:<cid>），互不覆盖
   - 成员仅能读自己那条（按 cid 隔离），后台需口令才能看全量
   - 口令校验复用 ADMIN_HASH，Worker 内不另存任何口令明文 */
async function handleChainApi(request, env, url) {
  const p = url.pathname, q = url.searchParams;
  const act = (q.get('act') || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';
  const CFG = 'ccfg:' + act, SUB = 'csub:' + act + ':', ACTS = 'cacts';
  const method = request.method;
  function cj(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  async function body() { try { return await request.json(); } catch (e) { return {}; } }
  function cidOf(v) { return String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64); }
  async function adminOk(pass) { return typeof pass === 'string' && (await sha256hex('wbs1:' + pass)) === ADMIN_HASH; }
  async function config() { return (await env.KV_DATA.get(CFG, 'json')) || null; }
  async function allEntries() {
    const list = await env.KV_DATA.list({ prefix: SUB });
    const rows = await Promise.all(list.keys.map(k => env.KV_DATA.get(k.name, 'json')));
    return rows.filter(Boolean).sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
  }
  async function allActs() { return (await env.KV_DATA.get(ACTS, 'json')) || []; }
  async function upsertAct(id, cfg) {
    const list = await allActs();
    const i = list.findIndex(a => a.id === id);
    const item = {
      id: id, title: (cfg && cfg.title) || id,
      deadline: (cfg && cfg.deadline) || '',
      fieldCount: (cfg && Array.isArray(cfg.fields)) ? cfg.fields.length : 0,
      updated_at: new Date().toISOString()
    };
    if (i >= 0) list[i] = item; else list.push(item);
    await env.KV_DATA.put(ACTS, JSON.stringify(list));
    return list;
  }

  /* 公开：活动列表（成员切换 / 后台复制填写链接用） */
  if (p === '/api/chain/acts' && method === 'GET') return cj({ acts: await allActs() });

  /* 公开：活动配置（成员渲染表单用） */
  if (p === '/api/chain/config' && method === 'GET') return cj({ config: await config() });

  /* 公开：成员读自己那条（cid 隔离，拿不到别人的） */
  if (p === '/api/chain/mine' && method === 'GET') {
    const cid = cidOf(q.get('cid'));
    return cj({ entry: cid ? (await env.KV_DATA.get(SUB + cid, 'json')) : null });
  }

  /* 公开：成员提交/更新自己那条（无需口令；截止日期后拒绝，防绕过前端） */
  if (p === '/api/chain/submit' && method === 'POST') {
    const b = await body(), cid = cidOf(b.cid);
    if (!cid) return cj({ error: 'NO_CID' }, 400);
    const curCfg = await config();
    if (curCfg && curCfg.deadline && new Date(curCfg.deadline).getTime() <= Date.now()) {
      return cj({ error: 'DEADLINE_PASSED', deadline: curCfg.deadline }, 403);
    }
    const old = await env.KV_DATA.get(SUB + cid, 'json');
    const entry = {
      id: (old && old.id) || cid, cid: cid,
      data: (b.data && typeof b.data === 'object') ? b.data : {},
      submittedAt: (old && old.submittedAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await env.KV_DATA.put(SUB + cid, JSON.stringify(entry));
    return cj({ ok: true, entry });
  }

  /* 后台：口令解锁后读全部（配置 + 名单） */
  if (p === '/api/chain/admin' && method === 'POST') {
    const b = await body();
    if (!(await adminOk(b.passcode))) return cj({ error: 'INVALID_PASSCODE' }, 403);
    return cj({ ok: true, config: await config(), entries: await allEntries(), acts: await allActs(), updated_at: new Date().toISOString() });
  }

  /* 后台：保存活动配置 */
  if (p === '/api/chain/config-save' && method === 'POST') {
    const b = await body();
    if (!(await adminOk(b.passcode))) return cj({ error: 'INVALID_PASSCODE' }, 403);
    if (!b.config || typeof b.config !== 'object') return cj({ error: 'BAD_CONFIG' }, 400);
    const cfg = Object.assign({}, b.config, { updated_at: new Date().toISOString() });
    if (cfg.deadline && isNaN(new Date(cfg.deadline).getTime())) delete cfg.deadline;
    await env.KV_DATA.put(CFG, JSON.stringify(cfg));
    await upsertAct(act, cfg);
    return cj({ ok: true, config: cfg });
  }

  /* 后台：删除单条（cid）或清空（无 cid） */
  if (p === '/api/chain/clear' && method === 'POST') {
    const b = await body();
    if (!(await adminOk(b.passcode))) return cj({ error: 'INVALID_PASSCODE' }, 403);
    if (b.cid) { await env.KV_DATA.delete(SUB + cidOf(b.cid)); return cj({ ok: true, removed: 1 }); }
    const list = await env.KV_DATA.list({ prefix: SUB });
    await Promise.all(list.keys.map(k => env.KV_DATA.delete(k.name)));
    return cj({ ok: true, removed: list.keys.length });
  }

  /* 后台：删除整个接龙（配置 + 全部名单，并从活动索引移除） */
  if (p === '/api/chain/delete-act' && method === 'POST') {
    const b = await body();
    if (!(await adminOk(b.passcode))) return cj({ error: 'INVALID_PASSCODE' }, 403);
    const list = await env.KV_DATA.list({ prefix: SUB });
    await Promise.all([env.KV_DATA.delete(CFG)].concat(list.keys.map(k => env.KV_DATA.delete(k.name))));
    const all = await allActs();
    await env.KV_DATA.put(ACTS, JSON.stringify(all.filter(a => a.id !== act)));
    return cj({ ok: true, removed: list.keys.length, act: act });
  }

  return cj({ error: 'CHAIN_NOT_FOUND' }, 404);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/data') return json({ error: 'NOT_FOUND' }, 404);
  if (!env.KV_DATA) return json({ error: 'KV_NOT_BOUND' }, 500);

  /* GET /api/data?key=xxx -> { payload, updated_at } 或 null */
  if (request.method === 'GET') {
    const key = url.searchParams.get('key');
    if (!validKey(key)) return json({ error: 'BAD_KEY' }, 400);
    const v = await env.KV_DATA.get('tool:' + key);
    return json(v ? JSON.parse(v) : null);
  }

  /* POST /api/data { passcode } -> { ok }（解锁前校验用） */
  if (request.method === 'POST') {
    let b = null;
    try { b = await request.json(); } catch (e) { /* 忽略 */ }
    if (!b || typeof b.passcode !== 'string') return json({ ok: false });
    const h = await sha256hex('wbs1:' + b.passcode);
    return json({ ok: h === ADMIN_HASH });
  }

  /* PUT /api/data { key, payload, passcode } -> { ok, updated_at } */
  if (request.method === 'PUT') {
    let b = null;
    try { b = await request.json(); } catch (e) { /* 忽略 */ }
    if (!b || !validKey(b.key) || typeof b.passcode !== 'string' || b.payload === undefined) {
      return json({ error: 'BAD_REQUEST' }, 400);
    }
    const h = await sha256hex('wbs1:' + b.passcode);
    if (h !== ADMIN_HASH) return json({ error: 'INVALID_PASSCODE' }, 403);
    const updated_at = new Date().toISOString();
    await env.KV_DATA.put('tool:' + b.key, JSON.stringify({ payload: b.payload, updated_at }));
    return json({ ok: true, updated_at });
  }

  return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/chain/')) return handleChainApi(request, env, url);
  if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    const res = await env.ASSETS.fetch(request);
    /* 若请求经过 Worker，强制 HTML/JS/CSS 每次回源校验，避免部署后仍拿到旧版 */
    if (res.body && res.status !== 304 && /\.(html?|js|css)$/i.test(url.pathname)) {
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'no-cache, must-revalidate');
      return out;
    }
    return res;
  }
};
