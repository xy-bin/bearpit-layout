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
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  }
};
