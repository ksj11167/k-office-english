/**
 * End-to-end walk of the whole app in a real browser.
 *
 * The unit tests cover the parser, which is the part most likely to be wrong in
 * a subtle way. They cannot catch the part most likely to be wrong in an obvious
 * way: a screen that never appears, a button wired to an id that no longer
 * exists, progress that does not survive a reload. Those only show up when
 * something actually clicks through the app, so this does.
 *
 * It runs on the sample conversation, which ships with English written in, so
 * the run needs no API key and makes no network call.
 *
 *   node test/e2e.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'app');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
    try {
      const buf = await readFile(join(ROOT, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

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

const SHARED_TXT = `대화방 님과 카카오톡 대화
--------------- 2026년 9월 15일 월요일 ---------------
[김세진] [오전 9:01] 공유로 들어온 말입니다
[박팀장] [오전 9:02] 네 확인했어요`;

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

// Hermetic: nothing leaves the machine. The app must work with the font CDN
// unreachable anyway, and a test that fails when Google is slow tells you
// nothing about the app.
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === '127.0.0.1') return route.continue();
  return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const screen = () => page.locator('.screen.on').first();
const screenId = async () => (await screen().getAttribute('id'));

try {
  await step('the app loads on the home screen with no script errors', async () => {
    await page.goto(base);
    await page.waitForSelector('.screen.on');
    assert(await screenId() === 's-home', 'expected s-home, got ' + await screenId());
    assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
  });

  await step('a first-time visitor is offered the sample, not a resume button', async () => {
    assert(await page.locator('#home-sample').isVisible(), 'sample button hidden on first run');
    assert(!(await page.locator('#go-resume').isVisible()), 'resume offered with nothing saved');
  });

  await step('the sample parses and lands on the read-check screen', async () => {
    await page.click('#home-sample');
    await page.waitForSelector('#s-preview.on');
    const stats = await page.locator('#stats .stat b').allTextContents();
    assert(stats[0] === '16', 'expected 16 messages, got ' + stats[0]);
    assert(stats[2] === '2', 'expected 2 days, got ' + stats[2]);
  });

  await step('the read-check shows the Korean conversation, both speakers', async () => {
    const text = await page.locator('#preview-tx').innerText();
    assert(text.includes('박팀장'), 'the other party is missing from the preview');
    assert(text.includes('배포 완료했습니다'), 'my own line is missing from the preview');
  });

  await step('splitting by day gives one deck per calendar day, newest first', async () => {
    await page.click('#go-days');
    await page.waitForSelector('#s-days.on');
    const days = await page.locator('#day-list .day .when b').allTextContents();
    assert(days.length === 2, 'expected 2 days, got ' + days.length);
    assert(days[0].includes('9월 13일'), 'newest day is not first: ' + days[0]);
  });

  await step('opening a day translates it and shows the English transcript', async () => {
    await page.click('#day-list .day >> nth=1');          // 9월 11일, the work chat
    await page.waitForSelector('#s-transcript.on', { timeout: 10000 });
    const text = await page.locator('#tx-body').innerText();
    assert(text.includes("I'm running QA on it right now."), 'my line was not translated');
    assert(text.includes('Sejin, where did that deploy end up yesterday?'),
      "the other party's line was not translated — this is the whole point of D18");
  });

  await step('the transcript keeps the Korean beside the English', async () => {
    const text = await page.locator('#tx-body').innerText();
    assert(text.includes('지금 QA 돌리고 있습니다'), 'the original Korean is gone');
  });

  await step('practice is blocked until I say which speaker is me', async () => {
    assert(await page.locator('#go-practice').isDisabled(), 'practice offered before picking me');
    const label = await page.locator('#go-practice').innerText();
    assert(label.includes('나를 먼저'), 'button does not say what is missing: ' + label);
  });

  await step('picking myself builds the deck from my lines only', async () => {
    await page.click('#tx-pick input[value="김세진"]');
    await page.waitForFunction(() => !document.getElementById('go-practice').disabled);
    const label = await page.locator('#go-practice').innerText();
    assert(label.includes('7장'), 'expected 7 of my lines that day, got: ' + label);
  });

  await step('a card shows English context, the Korean prompt, and hides the answer', async () => {
    await page.click('#go-practice');
    await page.waitForSelector('#s-practice.on');
    const card = page.locator('.swipe-card.front');
    const ctx = await card.locator('.ctx').innerText();
    assert(ctx.includes('Sejin, where did that deploy'),
      'context is not in English: ' + ctx.slice(0, 60));
    assert(await card.locator('.target').innerText() === '팀장님 그거 오늘까지 되나요?');
    assert(!(await card.locator('.answer').isVisible()), 'the answer was visible before flipping');
  });

  await step('flipping reveals the English answer', async () => {
    await page.click('.swipe-card.front .flip');
    const en = await page.locator('.swipe-card.front .en').innerText();
    assert(en === 'Does that need to be done by today?', 'wrong answer shown: ' + en);
  });

  await step('swiping right advances the deck and the progress bar', async () => {
    const before = await page.locator('#pr-count').innerText();
    await page.click('#sw-yes');
    await page.waitForFunction((b) => document.getElementById('pr-count').textContent !== b, before);
    const after = await page.locator('#pr-count').innerText();
    assert(after !== before, 'counter did not move: ' + before + ' -> ' + after);
  });

  await step('the arrow keys work as well as the buttons', async () => {
    const before = await page.locator('#pr-count').innerText();
    await page.locator('#deck').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((b) => document.getElementById('pr-count').textContent !== b, before);
  });

  await step('finishing the deck reaches the done screen', async () => {
    for (let i = 0; i < 10 && await screenId() === 's-practice'; i++) {
      await page.click('#sw-yes');
      await page.waitForTimeout(450);
    }
    await page.waitForSelector('#s-done.on', { timeout: 5000 });
    const stats = await page.locator('#done-stats .stat b').allTextContents();
    assert(+stats[0] > 0, 'no cards counted as learned this session');
  });

  await step('progress survives a reload', async () => {
    await page.reload();
    await page.waitForSelector('#s-home.on');
    assert(await page.locator('#go-resume').isVisible(), 'resume button missing after reload');
    await page.click('#go-resume');
    await page.waitForSelector('#s-days.on');
    const sub = await page.locator('#days-sub').innerText();
    assert(/카드 \d+개/.test(sub) && !/카드 0개/.test(sub), 'cards did not persist: ' + sub);
  });

  await step('a translated day reopens without translating again', async () => {
    await page.click('#day-list .day >> nth=1');
    await page.waitForSelector('#s-transcript.on', { timeout: 5000 });
    assert(await screenId() === 's-transcript', 'went through the build screen again');
  });

  await step('wiping clears the saved conversation', async () => {
    page.once('dialog', (d) => d.accept());
    await page.goto(base);
    await page.waitForSelector('#s-home.on');
    await page.click('#go-settings');
    await page.waitForSelector('#s-settings.on');
    await page.click('#wipe');
    await page.waitForSelector('#s-home.on');
    assert(!(await page.locator('#go-resume').isVisible()), 'resume survived the wipe');
  });

  await step('the English answer can be heard, and the button says so', async () => {
    await page.goto(base);
    await page.waitForSelector('#s-home.on');
    await page.click('#home-sample');
    await page.waitForSelector('#s-preview.on');
    await page.click('#go-days');
    await page.click('#day-list .day >> nth=1');
    await page.waitForSelector('#s-transcript.on', { timeout: 10000 });
    // The transcript is where these sentences are first met, so it speaks too.
    assert(await page.locator('#tx-body').evaluate((el) => el.classList.contains('speakable')),
      'transcript lines are not speakable');
    await page.click('#tx-pick input[value="김세진"]');
    await page.waitForFunction(() => !document.getElementById('go-practice').disabled);
    await page.click('#go-practice');
    await page.waitForSelector('#s-practice.on');
    await page.click('.swipe-card.front .flip');
    assert(await page.locator('.swipe-card.front .say').count() === 1,
      'no way to hear the answer after flipping');
  });

  await step('a shared export is picked up without touching the file input', async () => {
    // Stand in for the service worker's stash: the round trip it completes is
    // POST → cache → ?shared=1 → the app reads it. This checks the second half,
    // which is the part the app owns.
    await page.goto(base);
    await page.evaluate(async (txt) => {
      const c = await caches.open('koe-v3');
      await c.put('./__shared-export', new Response(txt, { headers: { 'content-type': 'text/plain' } }));
    }, SHARED_TXT);
    await page.goto(base + '?shared=1');
    await page.waitForSelector('#s-preview.on', { timeout: 8000 });
    const text = await page.locator('#preview-tx').innerText();
    assert(text.includes('공유로 들어온 말'), 'the shared conversation did not reach the preview');
    assert(!page.url().includes('shared=1'), 'the query string survived, so a reload would re-import');
  });

  await step('no script errors anywhere in the walk', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed` + (failures.length ? `, ${failures.length} failed` : ''));
if (failures.length) process.exitCode = 1;
