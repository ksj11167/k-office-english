/**
 * Store screenshots, taken from the running app.
 *
 * Both stores want phone-sized images and both reject mock-ups that do not match
 * what ships. Driving the real app means these cannot drift from it: if a screen
 * is renamed or a button moves, this fails instead of quietly shipping a picture
 * of an app that no longer exists.
 *
 * Runs on the sample conversation, so no key and no network.
 *
 *   node tools/screenshots.mjs [outDir]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'app');
const OUT = process.argv[2] || join(fileURLToPath(new URL('.', import.meta.url)), '..', 'store', 'screenshots');

/* 6.7" iPhone and a common Android phone, the two sizes the stores ask for. */
const SIZES = [
  { name: 'ios-6.7', width: 430, height: 932, scale: 3 },    // 1290 × 2796
  { name: 'android', width: 360, height: 640, scale: 3 },    // 1080 × 1920
];

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
    try {
      const buf = await readFile(join(ROOT, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
      res.end(buf);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  // Fonts come from a CDN; without them the shots render in fallback faces and
  // look nothing like the app, so let these through and wait for them.
  await page.goto(base);
  await page.waitForSelector('#s-home.on');
  await page.evaluate(() => document.fonts.ready);

  const shot = (n, name) => page.screenshot({ path: join(OUT, `${size.name}-${n}-${name}.png`) });

  await shot(1, 'home');

  await page.click('#home-sample');
  await page.waitForSelector('#s-preview.on');
  await shot(2, 'read-check');

  await page.click('#go-days');
  await page.waitForSelector('#s-days.on');
  await shot(3, 'days');

  await page.click('#day-list .day >> nth=1');
  await page.waitForSelector('#s-transcript.on', { timeout: 15000 });
  await page.click('#tx-pick input[value="김세진"]');
  await page.waitForFunction(() => !document.getElementById('go-practice').disabled);
  await shot(4, 'transcript');

  await page.click('#go-practice');
  await page.waitForSelector('#s-practice.on');
  await page.waitForTimeout(400);
  await shot(5, 'card');

  await page.click('.swipe-card.front .flip');
  await page.waitForTimeout(250);
  await shot(6, 'answer');

  await ctx.close();
  console.log(`  ${size.name}: 6 shots at ${size.width * size.scale}×${size.height * size.scale}`);
}

await browser.close();
server.close();
console.log(`\nwrote ${SIZES.length * 6} screenshots to ${OUT}`);

/* The landing page shows the same shots. Refreshing them here rather than by
   hand is the whole reason they cannot drift from the app. */
if (!process.argv[2]) {
  const SITE = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'site', 'shots');
  await mkdir(SITE, { recursive: true });
  const used = ['1-home', '3-days', '4-transcript', '5-card', '6-answer'];
  for (const n of used) await copyFile(join(OUT, `ios-6.7-${n}.png`), join(SITE, `${n}.png`));
  console.log(`refreshed ${used.length} shots in site/shots for the landing page`);
}
