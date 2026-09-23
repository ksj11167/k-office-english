/**
 * Tests for the translation proxy.
 *
 * The parts worth testing here are not "does it translate" — that is Anthropic's
 * job — but the promises the proxy makes about other people's conversations:
 * that the key never reaches the client, that a quota is spent before a model
 * call rather than after, that an upstream error body (which can quote the
 * prompt back) is never forwarded, and that the stored quota key cannot be read
 * backwards into an IP.
 *
 *   node server/worker.test.mjs
 */
import assert from 'node:assert/strict';
import worker from './worker.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failures.push(name);
    console.error('  FAIL ' + name + '\n       ' + e.message.split('\n')[0]);
  }
}

const ORIGIN = 'https://app.example';

/** In-memory stand-in for a Workers KV namespace. */
function kv() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
}

function env(over = {}) {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    ALLOWED_ORIGINS: ORIGIN,
    QUOTA_SALT: 'pepper',
    DAILY_LIMIT: 2,
    QUOTA: kv(),
    ...over,
  };
}

const post = (body, headers = {}) => new Request('https://proxy.example/translate', {
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** Swap global fetch for the duration of one call. */
async function withUpstream(impl, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
  try { return { result: await fn(), calls }; } finally { globalThis.fetch = real; }
}

const ok = (text) => new Response(JSON.stringify({
  content: [{ type: 'text', text }], stop_reason: 'end_turn',
}), { status: 200 });

await test('a good request is forwarded and the reply text comes back', async () => {
  const { result, calls } = await withUpstream(() => ok('[{"id":"m1","en":"Got it."}]'),
    () => worker.fetch(post({ prompt: '번역해줘' }), env()));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.match(body.text, /Got it/);
  assert.equal(calls.length, 1);
});

await test('the server key is sent upstream and never to the client', async () => {
  const { result, calls } = await withUpstream(() => ok('[]'),
    () => worker.fetch(post({ prompt: 'x' }), env()));
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-secret');
  const raw = JSON.stringify([...result.headers], null, 0) + await result.text();
  assert.ok(!raw.includes('sk-ant-secret'), 'the key leaked to the client');
});

await test('an unknown origin is refused before any model call', async () => {
  const { result, calls } = await withUpstream(() => ok('[]'),
    () => worker.fetch(post({ prompt: 'x' }, { origin: 'https://evil.example' }), env()));
  assert.equal(result.status, 403);
  assert.equal(calls.length, 0, 'a refused origin still cost a model call');
});

await test('the daily limit is spent before the model call, not after', async () => {
  const e = env();
  const run = () => withUpstream(() => ok('[]'), () => worker.fetch(post({ prompt: 'x' }), e));
  await run();
  await run();
  const { result, calls } = await run();          // third, over the limit of 2
  assert.equal(result.status, 429);
  assert.equal(calls.length, 0, 'the over-quota request still called the model');
  const body = await result.json();
  assert.equal(body.error, 'daily_limit');
  assert.equal(body.limit, 2);
});

await test('the stored quota key reveals neither the IP nor the salt', async () => {
  const e = env();
  await withUpstream(() => ok('[]'), () => worker.fetch(post({ prompt: 'x' }), e));
  const keys = [...e.QUOTA.m.keys()];
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes('203.0.113.9'), 'the raw IP is in the key');
  assert.ok(!keys[0].includes('pepper'), 'the salt is in the key');
});

await test('an upstream error body is replaced by a code, never forwarded', async () => {
  const leak = 'invalid_request: 팀장님 그거 오늘까지 되나요?';
  const { result } = await withUpstream(
    () => new Response(JSON.stringify({ error: { message: leak } }), { status: 400 }),
    () => worker.fetch(post({ prompt: 'x' }), env()));
  assert.equal(result.status, 400);
  const text = await result.text();
  assert.ok(!text.includes('팀장님'), 'the upstream body quoted the conversation back to the client');
  assert.equal(JSON.parse(text).error, 'invalid_request');
});

await test('a 401 upstream is not reported to the client as their fault', async () => {
  const { result } = await withUpstream(
    () => new Response('{}', { status: 401 }),
    () => worker.fetch(post({ prompt: 'x' }), env()));
  assert.equal(result.status, 500, "a bad server key is the server's problem, not a 401 at the client");
});

await test('a refusal is reported as a refusal', async () => {
  const { result } = await withUpstream(
    () => new Response(JSON.stringify({ content: [], stop_reason: 'refusal' }), { status: 200 }),
    () => worker.fetch(post({ prompt: 'x' }), env()));
  assert.equal(result.status, 422);
  assert.equal((await result.json()).error, 'refused');
});

await test('an oversized body is refused without being parsed', async () => {
  const { result, calls } = await withUpstream(() => ok('[]'),
    () => worker.fetch(post('x'.repeat(200_001)), env()));
  assert.equal(result.status, 413);
  assert.equal(calls.length, 0);
});

await test('only known models are accepted; anything else falls back', async () => {
  const { calls } = await withUpstream(() => ok('[]'),
    () => worker.fetch(post({ prompt: 'x', model: 'gpt-4' }), env()));
  assert.equal(JSON.parse(calls[0].init.body).model, 'claude-opus-5');

  const { calls: c2 } = await withUpstream(() => ok('[]'),
    () => worker.fetch(post({ prompt: 'x', model: 'claude-haiku-4-5' }), env()));
  assert.equal(JSON.parse(c2[0].init.body).model, 'claude-haiku-4-5');
});

await test('replies are marked no-store so a shared cache never holds a conversation', async () => {
  const { result } = await withUpstream(() => ok('[]'),
    () => worker.fetch(post({ prompt: 'x' }), env()));
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

await test('preflight is answered without a key and without a model call', async () => {
  const { result, calls } = await withUpstream(() => ok('[]'), () => worker.fetch(
    new Request('https://proxy.example/translate', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    env()));
  assert.equal(result.status, 204);
  assert.equal(result.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(calls.length, 0);
});

console.log(`\n${passed} passed` + (failures.length ? `, ${failures.length} failed` : ''));
if (failures.length) process.exitCode = 1;
