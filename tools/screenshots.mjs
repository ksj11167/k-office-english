/**
 * Drive the real app in a browser and save store screenshots.
 *
 * Both stores want images at exact pixel sizes, and both reject a mockup that
 * is not the app. So this walks the actual screens — first run, a card front,
 * a card back, the finish screen, the KakaoTalk preview — at a viewport whose
 * CSS size times the scale factor lands on the size the store asks for.
 *
 *   npx http-server app -p 8787 &
 *   node tools/screenshots.mjs [outDir] [--url http://127.0.0.1:8787]
 *
 * Playwright is not a dependency of the app — install it where you run this
 * (`npm i playwright`), or point CHROME_PATH at a Chromium you already have.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const outRoot = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--url') || 'store';
const base = flag('url', 'http://127.0.0.1:8787');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed here — run `npm i playwright` first');
  process.exit(1);
}

/* CSS size × scale = the pixel size each store asks for. */
const TARGETS = [
  { name: 'ios-6.7', viewport: { width: 430, height: 932 }, scale: 3 },   // 1290×2796
  { name: 'android-phone', viewport: { width: 360, height: 640 }, scale: 3 }, // 1080×1920
];

const launch = { ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) };
const browser = await chromium.launch(launch);

for (const t of TARGETS) {
  const dir = join(outRoot, t.name);
  mkdirSync(dir, { recursive: true });

  const ctx = await browser.newContext({ viewport: t.viewport, deviceScaleFactor: t.scale, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const shot = async (n, name) => {
    await page.screenshot({ path: join(dir, `${n}-${name}.png`) });
    console.log(`${t.name}/${n}-${name}.png`);
  };
  const settle = () => page.waitForTimeout(450);

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await settle();
  await shot(1, 'welcome');

  // Pick a job — that is the whole of onboarding, and it opens the deck.
  await page.locator('#welcome-jobs .day[data-job="dev"]').click();
  await settle();
  await shot(2, 'card-front');

  await page.locator('#deck .swipe-card.front .flip').click();
  await settle();
  await shot(3, 'card-back');

  // Mark a few known so the finish screen has something to report.
  for (let i = 0; i < 4; i++) {
    await page.locator('#sw-yes').click();
    await page.waitForTimeout(320);
  }
  await page.locator('#quit').click();
  await settle();
  await shot(4, 'done');

  await page.locator('#more-jobs').click();
  await settle();
  await shot(5, 'home');

  await page.locator('#go-import').click();
  await settle();
  await page.locator('#go-sample').click();
  await page.waitForTimeout(700);
  await shot(6, 'kakao-preview');

  await ctx.close();
}

await browser.close();
