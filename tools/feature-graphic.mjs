/**
 * Render the Play feature graphic from its source page.
 *
 * Play asks for exactly 1024×500 with no transparency, and it is the first
 * thing anyone sees above the listing. Keeping it as HTML rather than a flat
 * export means it is edited in the same tokens and typefaces as the app — and
 * that a wording change is a one-line edit followed by one command, not a trip
 * through a design tool.
 *
 *   node tools/feature-graphic.mjs [out.png]
 *
 * Playwright is not a dependency of the app; it is a devDependency used by the
 * browser tests, so this runs wherever those do.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HERE, '..', 'store', 'feature-graphic.html');
const OUT = process.argv[2] || join(HERE, '..', 'store', 'feature-graphic.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });

await page.goto('file://' + SRC, { waitUntil: 'load' });
// The faces are inlined in the source, so this waits on decoding rather than on
// the network — and the render is identical on a machine with no network at all.
// That is deliberate: the first attempt at this graphic silently fell back to a
// system CJK face because the CDN was unreachable, and the only sign was that
// the Korean looked subtly wrong.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const box = await page.locator('.frame').boundingBox();
if (!box || box.width !== 1024 || box.height !== 500) {
  console.error(`frame is ${box?.width}×${box?.height}, Play wants exactly 1024×500`);
  process.exit(1);
}

// omitBackground stays false on purpose: a feature graphic carrying alpha is
// rejected, so the PNG must be fully opaque.
await page.screenshot({ path: OUT, clip: box, omitBackground: false });
await browser.close();

console.log(`wrote ${OUT} — 1024×500, opaque`);
