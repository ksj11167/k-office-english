/**
 * The offline shell only works if the precache list is complete.
 *
 * It was not: job-decks.js and platform.js are imported by main.js but were
 * missing from SHELL, so the app opened on a train and then failed on its own
 * imports. That is the kind of gap nobody notices until they are underground,
 * which is exactly when the app promises to work — so the list is checked
 * against the directory rather than maintained by memory.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const here = new URL('.', import.meta.url);
const sw = readFileSync(new URL('sw.js', here), 'utf8');
const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

const files = (dir, ext) =>
  readdirSync(new URL(dir, here))
    .filter((f) => f.endsWith(ext) && !f.endsWith('.test.mjs'))
    .map((f) => (dir === './' ? f : dir.replace('./', '') + f));

test('every app module is precached', () => {
  for (const f of files('./js/', '.js')) {
    assert.ok(shell.includes(f), `sw.js SHELL is missing ${f} — the app breaks offline without it`);
  }
});

test('every vendored module is precached', () => {
  for (const f of files('./vendor/', '.mjs')) {
    assert.ok(shell.includes(f), `sw.js SHELL is missing ${f}`);
  }
});

test('every page is precached', () => {
  for (const f of files('./', '.html')) {
    assert.ok(shell.includes(f), `sw.js SHELL is missing ${f}`);
  }
});

test('the precache list has no entries that do not exist', () => {
  const on_disk = new Set([
    './', ...files('./', '.html'), ...files('./js/', '.js'), ...files('./vendor/', '.mjs'),
    ...files('./', '.css'), ...files('./', '.webmanifest'),
    ...readdirSync(new URL('./icons/', here)).map((f) => 'icons/' + f),
  ]);
  for (const f of shell) {
    assert.ok(on_disk.has(f) || f === '', `sw.js precaches ${f}, which is not in app/`);
  }
});

console.log(`\n${passed} passed`);
