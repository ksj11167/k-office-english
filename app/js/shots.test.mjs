import assert from 'node:assert/strict';
import { tilesFor, scaleFor, MAX_EDGE } from './shots.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + e.message);
    process.exitCode = 1;
  }
}

test('an ordinary phone screenshot is one tile', () => {
  assert.deepEqual(tilesFor(1080, 2400), [{ y: 0, h: 2400 }]);
});

test('a scroll capture is cut into overlapping tiles that cover it all', () => {
  const tiles = tilesFor(1080, 9000);
  assert.ok(tiles.length >= 4, 'expected several tiles, got ' + tiles.length);
  assert.equal(tiles[0].y, 0);
  const last = tiles[tiles.length - 1];
  assert.equal(last.y + last.h, 9000, 'the bottom of the capture is lost');
  for (let i = 1; i < tiles.length; i++) {
    const prevEnd = tiles[i - 1].y + tiles[i - 1].h;
    assert.ok(tiles[i].y < prevEnd, `tiles ${i - 1} and ${i} do not overlap`);
  }
});

test('each tile, once scaled, keeps text big enough to read', () => {
  for (const t of tilesFor(1080, 9000)) {
    const k = scaleFor(1080, t.h);
    assert.ok(Math.max(1080, t.h) * k <= MAX_EDGE + 1);
    assert.ok(1080 * k >= 650, 'tile shrunk to ' + Math.round(1080 * k) + 'px wide');
  }
});

test('small images are never scaled up', () => {
  assert.equal(scaleFor(600, 900), 1);
});

console.log(`\n${passed} passed`);
