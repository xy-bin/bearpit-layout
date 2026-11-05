/* Cloudflare Pages Function：/api/data
   公开读 + 口令写（sha256 服务端校验，口令哈希不含明文）
   需要在 Pages 项目设置中绑定 KV 命名空间，变量名：KV_DATA */
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

/* GET /api/data?key=xxx -> { payload, updated_at } 或 null */
export async function onRequestGet({ env, request }) {
  const key = new URL(request.url).searchParams.get('key');
  if (!validKey(key)) return json({ error: 'BAD_KEY' }, 400);
  if (!env.KV_DATA) return json({ error: 'KV_NOT_BOUND' }, 500);
  const v = await env.KV_DATA.get('tool:' + key);
  return json(v ? JSON.parse(v) : null);
}

/* POST /api/data { passcode } -> { ok: true|false }（解锁前校验用） */
export async function onRequestPost({ request }) {
  let b = null;
  try { b = await request.json(); } catch (e) { /* 忽略 */ }
  if (!b || typeof b.passcode !== 'string') return json({ ok: false });
  const h = await sha256hex('wbs1:' + b.passcode);
  return json({ ok: h === ADMIN_HASH });
}

/* PUT /api/data { key, payload, passcode } -> { ok, updated_at } */
export async function onRequestPut({ env, request }) {
  if (!env.KV_DATA) return json({ error: 'KV_NOT_BOUND' }, 500);
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
