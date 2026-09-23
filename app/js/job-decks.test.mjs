import assert from 'node:assert/strict';
import { JOB_DECKS, findDeck } from './job-decks.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

test('every deck has an id, a name, a blurb and cards', () => {
  assert.ok(JOB_DECKS.length >= 3, 'need enough decks to be worth a picker');
  for (const d of JOB_DECKS) {
    assert.match(d.id, /^[a-z]+$/, `bad id: ${d.id}`);
    assert.ok(d.name && d.name.trim(), `deck ${d.id} has no name`);
    assert.ok(d.blurb && d.blurb.trim(), `deck ${d.id} has no blurb`);
    assert.ok(Array.isArray(d.cards) && d.cards.length >= 8, `deck ${d.id} is too thin`);
  }
});

test('every deck carries the 40 cards the milestone counts on', () => {
  // The decks are off-screen for v1 and waiting on a milestone, which is
  // exactly when content rots unwatched. Forty a job is what the PRD's
  // milestone table claims is ready; this is what makes that claim true.
  for (const d of JOB_DECKS) {
    assert.ok(d.cards.length >= 40, `deck ${d.id} has ${d.cards.length} cards, needs 40`);
  }
});

test('deck ids are unique', () => {
  const ids = JOB_DECKS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every card carries Korean, English and a situation tag', () => {
  for (const d of JOB_DECKS) {
    for (const c of d.cards) {
      assert.ok(c.ko && c.ko.trim(), `${d.id}: card with no Korean`);
      assert.ok(c.en && c.en.trim(), `${d.id}: "${c.ko}" has no English`);
      assert.ok(c.situation && c.situation.trim(), `${d.id}: "${c.ko}" has no situation`);
      assert.ok(Array.isArray(c.context), `${d.id}: "${c.ko}" context must be an array`);
    }
  }
});

test('English is actually English, Korean is actually Korean', () => {
  for (const d of JOB_DECKS) {
    for (const c of d.cards) {
      assert.ok(/[가-힣]/.test(c.ko), `${d.id}: front is not Korean — ${c.ko}`);
      assert.ok(/[A-Za-z]/.test(c.en), `${d.id}: back is not English — ${c.en}`);
      assert.ok(!/[가-힣]/.test(c.en), `${d.id}: Korean leaked into the English — ${c.en}`);
    }
  }
});

test('no editing artifacts survived into the content', () => {
  for (const d of JOB_DECKS) {
    for (const c of d.cards) {
      for (const [field, v] of Object.entries({ ko: c.ko, en: c.en, situation: c.situation })) {
        assert.ok(!/replace\(|",$|undefined|null/.test(v), `${d.id}.${field} looks like leftover code: ${v}`);
      }
    }
  }
});

test('situation tags stay short enough for the card chip', () => {
  for (const d of JOB_DECKS) {
    for (const c of d.cards) {
      assert.ok(c.situation.length <= 8, `${d.id}: situation too long for the chip — ${c.situation}`);
    }
  }
});

test('context turns name a speaker and say something', () => {
  for (const d of JOB_DECKS) {
    for (const c of d.cards) {
      for (const t of c.context) {
        assert.ok(t.speaker && t.speaker.trim(), `${d.id}: context turn with no speaker`);
        assert.ok(t.text && t.text.trim(), `${d.id}: context turn with no text`);
      }
    }
  }
});

test('no duplicate Korean lines inside a deck', () => {
  for (const d of JOB_DECKS) {
    const kos = d.cards.map((c) => c.ko);
    assert.equal(new Set(kos).size, kos.length, `${d.id} repeats a line`);
  }
});

test('findDeck resolves a real id and rejects an unknown one', () => {
  assert.equal(findDeck('dev').name, '개발');
  assert.equal(findDeck('nope'), undefined);
});

console.log(`\n${passed} passed`);
