/**
 * A swipeable card stack, the dating-app gesture applied to review.
 *
 * Why the gesture earns its place here: grading a card is a binary judgement
 * made dozens of times in a row, and a throw of the thumb is faster and more
 * physical than hunting for a button. The drag is continuous — the card tracks
 * the finger and the verdict label fades in as you commit — so the decision is
 * visible before you let go, and a half-hearted drag springs back instead of
 * being counted.
 *
 * Right means "said it", left means "didn't". The same decisions stay reachable
 * from buttons and arrow keys, because a gesture-only control is unusable with a
 * keyboard and awkward on a desktop trackpad.
 */

const THROW = 140;          // px of travel before a release counts as a decision
const FLICK = 0.45;         // px/ms — a fast flick commits at a shorter distance
const DEPTH = 3;            // cards kept in the DOM, front one included

export function createSwipeDeck(root, { render, onSwipe, onEmpty }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let items = [];
  let pos = 0;
  let cards = [];
  let busy = false;

  root.classList.add('deck');
  root.tabIndex = 0;

  function build() {
    root.textContent = '';
    cards = [];
    for (let d = DEPTH - 1; d >= 0; d--) {           // back-most first, so front paints last
      const el = document.createElement('article');
      el.className = 'swipe-card';
      el.innerHTML =
        '<div class="verdict yes" aria-hidden="true">결재</div>' +
        '<div class="verdict no" aria-hidden="true">반려</div>' +
        '<div class="swipe-body"></div>';
      root.append(el);
      cards.unshift(el);                              // cards[0] is the front card
    }
    paint();
  }

  /** Put the right content and resting transform on each of the DEPTH cards. */
  function paint() {
    for (let d = 0; d < DEPTH; d++) {
      const el = cards[d];
      const item = items[pos + d];
      if (!item) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      el.style.transition = 'none';
      el.style.transform = rest(d);
      el.style.opacity = d === 0 ? '1' : '1';
      el.style.zIndex = String(DEPTH - d);
      el.classList.toggle('front', d === 0);
      el.setAttribute('aria-hidden', d === 0 ? 'false' : 'true');
      setShift(el, 0);
      render(el.querySelector('.swipe-body'), item, d);
    }
    // Force the browser to accept the transition-less transform before we allow
    // animation again, otherwise the next drag animates from the old position.
    void root.offsetHeight;
    for (const el of cards) el.style.transition = '';
  }

  const rest = (d) => `translate3d(0, ${d * 10}px, 0) scale(${1 - d * 0.04})`;

  /** Drag feedback: follow the finger, tilt a little, fade in the verdict. */
  function setShift(el, dx, dy = 0) {
    const t = Math.max(-1, Math.min(1, dx / THROW));
    el.style.transform =
      `translate3d(${dx}px, ${dy}px, 0) rotate(${t * 7}deg)`;
    el.querySelector('.verdict.yes').style.opacity = String(Math.max(0, t));
    el.querySelector('.verdict.no').style.opacity = String(Math.max(0, -t));
  }

  /* ---------- pointer drag on the front card ---------- */

  let dragging = false;
  let startX = 0, startY = 0, startT = 0, dx = 0, dy = 0, pid = null;

  root.addEventListener('pointerdown', (e) => {
    if (busy || !items[pos]) return;
    const front = cards[0];
    if (!front || front.hidden || !front.contains(e.target)) return;
    // Let the reveal button and the mic inside the card work normally.
    if (e.target.closest('[data-no-drag]')) return;
    dragging = true;
    pid = e.pointerId;
    startX = e.clientX; startY = e.clientY; startT = performance.now();
    dx = 0; dy = 0;
    front.style.transition = 'none';
    front.setPointerCapture(pid);
  });

  root.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    if (Math.abs(dx) > 6) e.preventDefault();
    setShift(cards[0], dx, dy * 0.25);
  });

  function endDrag(e) {
    if (!dragging || (e && e.pointerId !== pid)) return;
    dragging = false;
    const front = cards[0];
    try { front.releasePointerCapture(pid); } catch { /* pointer already gone */ }
    front.style.transition = '';
    const speed = Math.abs(dx) / Math.max(1, performance.now() - startT);
    if (Math.abs(dx) > THROW || speed > FLICK) {
      commit(dx > 0 ? 'right' : 'left');
    } else {
      setShift(front, 0);
    }
  }
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  /* ---------- keyboard ---------- */

  root.addEventListener('keydown', (e) => {
    if (busy) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); commit('right'); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); commit('left'); }
  });

  /* ---------- committing a decision ---------- */

  function commit(dir) {
    const item = items[pos];
    if (!item || busy) return;
    busy = true;
    const front = cards[0];
    const away = (dir === 'right' ? 1 : -1) * (window.innerWidth + 260);

    const finish = () => {
      pos++;
      onSwipe(item, dir);
      if (pos >= items.length) {
        for (const el of cards) el.hidden = true;
        busy = false;
        onEmpty();
        return;
      }
      paint();
      busy = false;
    };

    if (reduced) { finish(); return; }

    front.style.transition = 'transform .32s cubic-bezier(.2,.7,.3,1), opacity .32s ease';
    front.style.transform = `translate3d(${away}px, ${dy * 0.3}px, 0) rotate(${dir === 'right' ? 18 : -18}deg)`;
    front.style.opacity = '0';
    let done = false;
    const once = () => { if (!done) { done = true; finish(); } };
    front.addEventListener('transitionend', once, { once: true });
    setTimeout(once, 420);   // transitionend can be skipped on a backgrounded tab
  }

  return {
    load(next) {
      items = next;
      pos = 0;
      busy = false;
      build();
      if (items.length === 0) onEmpty();
    },
    swipe: commit,
    remaining: () => Math.max(0, items.length - pos),
    total: () => items.length,
    current: () => items[pos] || null,
    focus: () => root.focus({ preventScroll: true }),
  };
}
