/**
 * The app talking to the real proxy, in a real browser.
 *
 * Both halves already had tests and neither covered the seam between them:
 * server/worker.test.mjs calls worker.fetch() directly with no browser, and the
 * browser walk runs on the sample deck, which never translates anything. So
 * `viaProxy` in translate.js — the code path every ordinary user will take —
 * had never executed.
 *
 * This runs the actual worker over HTTP, points a real build of the app at it,
 * and drives the whole import → translate → transcript → cards flow in Chromium.
 * Anthropic is stubbed: the point is the contract between the app and the proxy,
 * and a test that needs a funded API key is a test nobody runs.
 *
 *   node test/proxy-integration.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, cp, writeFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import worker from '../server/worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

let passed = 0;
const failures = [];
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failures.push(name);
    console.error('  FAIL ' + name + '\n       ' + e.message.split('\n')[0]);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* A day of conversation the sample does not contain, so a translation that
   appears in the app can only have come through the proxy. */
const EXPORT = `대화방 님과 카카오톡 대화
--------------- 2026년 9월 15일 월요일 ---------------
[박팀장] [오전 9:05] 오늘 회의 몇 시였죠?
[김세진] [오전 9:06] 두 시입니다
[김세진] [오전 9:07] 자료는 미리 올려두겠습니다
[박팀장] [오전 9:08] 네 부탁드려요
[김세진] [오전 9:09] 넵`;

/* Stands in for Anthropic. Echoes back a translation per line so the assertions
   can tell a proxied answer from anything else. */
const SERVER_KEY = 'sk-ant-SERVERONLY-do-not-leak';
let upstreamCalls = 0;
let upstreamMode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.anthropic.com')) return realFetch(url, init);
  upstreamCalls++;
  if (upstreamMode === 'rate_limited') return new Response('{"error":"slow down"}', { status: 429 });

  const body = JSON.parse(init.body);
  const prompt = body.messages[0].content;
  // The prompt shows the model an example array before the real one, so take
  // the last array in the text, not the first.
  const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1));
  const rows = items.filter((i) => !i.ref).map((i) => ({
    id: i.id, en: 'EN<' + i.ko.replace(/\n/g, ' ') + '>', situation: '상황',
  }));
  return new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(rows) }],
    stop_reason: 'end_turn',
  }), { status: 200 });
};

/* ── the proxy, over HTTP, exactly as deployed ── */
function serveWorker(env) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = `http://${req.headers.host}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const out = await worker.fetch(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function serveDir(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
    try {
      const buf = await readFile(join(root, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
      res.end(buf);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

const kv = () => {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
};

/* Deploy order matters and is easy to get backwards: the app must be built with
   the proxy's address and the proxy must allow the app's origin. Neither can be
   known before its server is listening, so the app is built and served first and
   its address is patched in afterwards — the same two-step the real PROXY_URL /
   ALLOWED_ORIGINS pair needs. */
const appDir = await mkdtemp(join(tmpdir(), 'koe-app-'));
await cp(APP, appDir, { recursive: true });
const served = await serveDir(appDir);
const base = `http://127.0.0.1:${served.address().port}/`;
const appOrigin = base.replace(/\/$/, '');

const quota = kv();
const proxy = await serveWorker({
  ANTHROPIC_API_KEY: SERVER_KEY,
  ALLOWED_ORIGINS: appOrigin,
  QUOTA_SALT: 'pepper',
  DAILY_LIMIT: 2,
  QUOTA: quota,
});
const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`;

// Exactly what .github/workflows/pages.yml does at deploy time.
{
  const p = join(appDir, 'js', 'translate.js');
  const src = await readFile(p, 'utf8');
  assert(src.includes("export const PROXY_URL = '';"),
    'PROXY_URL placeholder is gone — the deploy substitution would silently do nothing');
  await writeFile(p, src.replace("export const PROXY_URL = '';", `export const PROXY_URL = '${proxyOrigin}';`));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
/* Two kinds of "error" show up here and only one is a bug. A thrown exception
   always is. A console line about a 429 is the browser reporting a response the
   last two steps ask for on purpose, so those are counted separately and only
   checked before the failures are induced. */
const scriptErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => scriptErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
let consoleClean = 0;
await page.route('**/*', (route) => {
  const h = new URL(route.request().url()).hostname;
  if (h === '127.0.0.1') return route.continue();
  return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
});

try {
  await step('the app sees a translation server and stops asking for a key', async () => {
    await page.goto(base);
    await page.waitForSelector('#s-home.on');
    await page.waitForFunction(() => !document.getElementById('go-import').textContent.includes('API 키'), null, { timeout: 8000 });
    assert(await page.locator('#home-note').isHidden(), 'the no-server warning is still showing');
  });

  await step('an imported conversation is translated through the proxy', async () => {
    await page.click('#go-import');
    await page.waitForSelector('#s-import.on');
    await page.fill('#paste', EXPORT);
    await page.click('#go-parse');
    await page.waitForSelector('#s-preview.on');
    await page.click('#go-days');
    await page.waitForSelector('#s-days.on');
    await page.click('#day-list .day >> nth=0');
    await page.waitForSelector('#s-transcript.on', { timeout: 15000 });

    const text = await page.locator('#tx-body').innerText();
    assert(text.includes('EN<두 시입니다>'), 'my line did not come back translated: ' + text.slice(0, 80));
    assert(text.includes('EN<오늘 회의 몇 시였죠?>'), "the other party's line was not translated");
    assert(upstreamCalls === 1, 'expected one upstream call, got ' + upstreamCalls);
  });

  await step('the key never reaches the browser', async () => {
    const html = await page.content();
    assert(!html.includes(SERVER_KEY), "the server's key appeared in the page");
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    assert(!stored.includes(SERVER_KEY), "the server's key was written to localStorage");
  });

  await step('cards build from the proxied translation', async () => {
    await page.click('#tx-pick input[value="김세진"]');
    await page.waitForFunction(() => !document.getElementById('go-practice').disabled);
    await page.click('#go-practice');
    await page.waitForSelector('#s-practice.on');
    await page.click('.swipe-card.front .flip');
    const en = await page.locator('.swipe-card.front .en').innerText();
    assert(en.startsWith('EN<'), 'the card answer did not come from the proxy: ' + en);
  });

  await step('a re-opened day does not pay for translation twice', async () => {
    const before = upstreamCalls;
    await page.click('#quit');
    await page.waitForSelector('#s-done.on');
    await page.click('#pick-day');
    await page.click('#day-list .day >> nth=0');
    await page.waitForSelector('#s-transcript.on', { timeout: 8000 });
    assert(upstreamCalls === before, 'translating again cost another call');
  });

  // Everything from here on asks the proxy to refuse, so the browser's own
  // reports of those refusals stop counting as findings.
  consoleClean = consoleErrors.length;

  await step('running out of the daily quota is explained, not just failed', async () => {
    // DAILY_LIMIT is 2 and the first import already spent one.
    for (const day of ['9월 16일', '9월 17일']) {
      await page.goto(base);
      await page.waitForSelector('#s-home.on');
      await page.click('#go-import');
      await page.fill('#paste', EXPORT.replace('9월 15일', day));
      await page.click('#go-parse');
      await page.waitForSelector('#s-preview.on');
      await page.click('#go-days');
      await page.click('#day-list .day >> nth=0');
      // The build screen appears while translating, so the settled state is what
      // matters: a transcript on success, or the back button on failure.
      await page.waitForSelector('#s-transcript.on, #build-back:not(.hide)', { timeout: 15000 });
      if (await page.locator('#build-back:not(.hide)').count()) break;
    }
    assert(await page.locator('#build-back:not(.hide)').count(), '한도에 걸리지 않았습니다');
    const sub = await page.locator('#build-sub').innerText();
    assert(/무료 번역|한도|다 썼/.test(sub), '한도 초과를 사람 말로 설명하지 않습니다: ' + sub);
  });

  await step('an upstream failure is reported without leaking the reason', async () => {
    upstreamMode = 'rate_limited';
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.goto(base);
    await page.waitForSelector('#s-home.on');
    await page.click('#go-import');
    await page.fill('#paste', EXPORT.replace('9월 15일', '9월 20일'));
    await page.click('#go-parse');
    await page.waitForSelector('#s-preview.on');
    await page.click('#go-days');
    await page.click('#day-list .day >> nth=0');
    await page.waitForSelector('#build-back:not(.hide)', { timeout: 15000 });
    const sub = await page.locator('#build-sub').innerText();
    assert(sub.trim().length > 0, 'the failure screen says nothing');
    assert(!/slow down/.test(sub), "the upstream's own error body reached the user: " + sub);
    upstreamMode = 'ok';
  });

  await step('no script errors across the whole proxied run', async () => {
    assert(scriptErrors.length === 0, scriptErrors.join(' | '));
    assert(consoleErrors.slice(0, consoleClean).length === 0,
      'console errors before any failure was induced: ' + consoleErrors.slice(0, consoleClean).join(' | '));
  });
} finally {
  await browser.close();
  served.close();
  proxy.close();
}

console.log(`\n${passed} passed` + (failures.length ? `, ${failures.length} failed` : ''));
if (failures.length) process.exitCode = 1;
