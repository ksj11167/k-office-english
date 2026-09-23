import { parseKakaoExport, groupByDay, cardsForSpeaker, speakersIn, guessRoomType } from './kakao-parser.js';
import { newCardState, review, isDue, isLearned, dueLabel } from './srs.js';
import { createSwipeDeck } from './swipe.js';
import * as T from './translate.js';
import { isNative, platform, onSharedChatExport, createRecogniser, createSpeaker } from './platform.js';

/* The sample ships with English written in, so the whole loop — the transcript,
   the swipe and the scheduler — works before any provider is configured. It is
   also the only thing in the app that runs without one. */
const SAMPLE_TXT = `저장한 날짜 : 2026-09-14 22:14:03

개발3팀 님과 카카오톡 대화
--------------- 2026년 9월 11일 금요일 ---------------
[박팀장] [오전 9:12] 세진님 어제 그 배포 건 어떻게 됐어요?
[김세진] [오전 9:15] 팀장님 그거 오늘까지 되나요?
[김세진] [오전 9:16] 지금 QA 돌리고 있습니다
[박팀장] [오전 9:16] 네 오늘까지 부탁드려요
[김세진] [오전 9:17] 넵
[김세진] [오전 11:40] 방금 확인했는데 이슈가 하나 있어서
좀 늦어질 것 같습니다
[박팀장] [오전 11:42] 얼마나 걸릴까요?
[김세진] [오전 11:45] 두 시간 정도면 될 것 같아요
[김세진] [오후 2:31] 배포 완료했습니다!
[박팀장] [오후 2:33] 고생하셨어요
[김세진] [오후 2:34] 감사합니다 주말 잘 보내세요
--------------- 2026년 9월 13일 일요일 ---------------
[민수] [오후 7:40] 내일 저녁에 시간 돼?
[김세진] [오후 7:44] 어 될 것 같은데 몇 시쯤?
[민수] [오후 7:45] 7시쯤 어때
[김세진] [오후 7:46] 좋아 그때 보자
[김세진] [오후 7:46] 어디서 볼지는 내일 정하자`;

/* Every line, not just 김세진's — the sample has to demonstrate the thing the
   app actually does now, which is turning the whole conversation into English. */
const SAMPLE_EN = {
  '세진님 어제 그 배포 건 어떻게 됐어요?': ['Sejin, where did that deploy end up yesterday?', '진행 확인'],
  '팀장님 그거 오늘까지 되나요?': ['Does that need to be done by today?', '마감 확인'],
  '지금 QA 돌리고 있습니다': ["I'm running QA on it right now.", '진행 보고'],
  '네 오늘까지 부탁드려요': ['Yes — today if you can.', '요청'],
  '넵': ['Got it.', '수락'],
  '방금 확인했는데 이슈가 하나 있어서\n좀 늦어질 것 같습니다': ["I just checked and there's an issue, so it's going to run a bit late.", '지연 알림'],
  '얼마나 걸릴까요?': ['How long do you think?', '소요 확인'],
  '두 시간 정도면 될 것 같아요': ['I think about two hours should do it.', '일정 추정'],
  '배포 완료했습니다!': ["The deploy's done!", '완료 보고'],
  '고생하셨어요': ['Nice work.', '격려'],
  '감사합니다 주말 잘 보내세요': ['Thanks — have a good weekend!', '인사'],
  '내일 저녁에 시간 돼?': ['You free tomorrow evening?', '약속 제안'],
  '어 될 것 같은데 몇 시쯤?': ['Yeah, I think so — what time?', '약속 잡기'],
  '7시쯤 어때': ['How about seven?', '시간 제안'],
  '좋아 그때 보자': ['Sounds good, see you then.', '약속 확정'],
  '어디서 볼지는 내일 정하자': ["Let's figure out where tomorrow.", '보류'],
};

/* v4: a day now stores the whole translated conversation, not only my cards. */
const STORE = 'rte.v4';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = { me: null, roomTitle: null, days: [], usingSample: false };
let parsed = null;
let activeDay = null;
let deck = null;
let sessionDone = 0;
let sessionTotal = 0;
let heardText = '';
let recog = null;
let listening = false;
const speaker = createSpeaker();

function show(name) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('on', el.id === 's-' + name);
  window.scrollTo(0, 0);
}

/* ══════ storage ══════ */
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } };
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    return v && Array.isArray(v.days) ? v : null;
  } catch { return null; }
}

/* ══════ home ══════ */
$('go-import').addEventListener('click', () => show('import'));
$('go-resume').addEventListener('click', () => { renderDays(); show('days'); });
$('home-sample').addEventListener('click', () => ingest(SAMPLE_TXT, true));

/* The home screen has to tell the truth about what this copy of the app can
   do. On a build with no translation provider — the public link, before the
   proxy exists — importing your own chat runs into a wall three screens later.
   So when there is no provider, the sample leads and the import says why. */
function refreshHome() {
  const has = state.days.length > 0;
  const canTranslate = T.provider() !== 'none';

  $('go-resume').classList.toggle('hide', !has);
  $('home-sample').classList.toggle('hide', has);
  $('home-note').classList.toggle('hide', canTranslate);

  $('go-import').classList.toggle('ghost', !canTranslate && !has);
  $('home-sample').classList.toggle('ghost', !canTranslate);
  $('go-import').textContent = canTranslate
    ? '내 카톡 대화 가져오기'
    : '내 카톡 대화 가져오기 (API 키 필요)';

  if (!has) return;
  const remaining = state.days.filter((d) => dayStatus(d) !== 'done').length;
  $('go-resume').textContent = remaining ? `이어서 하기 · ${remaining}일 남음` : `복습하기 · ${state.days.length}일치`;
}

/* ══════ import ══════ */
const paste = $('paste');
paste.addEventListener('input', () => { $('go-parse').disabled = paste.value.trim().length < 10; });

$('file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    paste.value = await f.text();
    $('go-parse').disabled = false;
    ingest(paste.value, false);
  } catch {
    $('import-err').textContent = '파일을 읽지 못했습니다. 내용을 직접 붙여넣어 주세요.';
  }
});
$('go-parse').addEventListener('click', () => ingest(paste.value, false));
$('go-sample').addEventListener('click', () => ingest(SAMPLE_TXT, true));
$('back-home').addEventListener('click', () => { refreshHome(); show('home'); });
$('back-preview').addEventListener('click', () => show('import'));
$('back-days').addEventListener('click', () => { if (parsed) show('preview'); else { refreshHome(); show('home'); } });

function ingest(raw, isSample) {
  const p = parseKakaoExport(raw);
  if (p.messages.length === 0) {
    $('import-err').textContent =
      '카톡 대화 형식을 찾지 못했습니다. 카톡에서 «대화 내용 내보내기 → 텍스트만»으로 저장한 파일인지 확인해 주세요.';
    show('import');
    return;
  }
  $('import-err').textContent = '';
  parsed = p;
  state.usingSample = isSample;
  state.roomTitle = p.roomTitle;
  renderPreview();
  show('preview');
}

/* ══════ preview ══════ */
/* The gate survives on one of its two legs. Translating everything (D18) killed
   the "don't pay to translate what you'll throw away" argument, but parsing a
   format Kakao never promised to keep still breaks, and translating garbage
   still wastes the call. So this screen checks the read, and nothing else —
   picking who I am now happens after the English exists (D19). */
function renderPreview() {
  const groups = groupByDay(parsed);
  const days = new Set(parsed.messages.map((m) => m.date).filter(Boolean)).size;
  $('stats').innerHTML = [
    ['메시지', parsed.messages.length],
    ['참여자', parsed.speakers.length],
    ['날짜', days || '—'],
    ['형식', parsed.format === 'android' ? 'Android' : parsed.format === 'ios' ? 'iOS' : parsed.format],
  ].map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${k}</span></div>`).join('');

  $('preview-tx').innerHTML = parsed.messages.slice(0, 40).map((m) => {
    const mine = state.me && m.speaker === state.me;
    return `<div class="bub ${mine ? 'mine' : ''} ${m.media ? 'media' : ''}">` +
      `<span class="who">${esc(m.speaker)}</span>` +
      esc(m.media ? `(${m.text})` : m.text) + '</div>';
  }).join('');

  $('go-days').disabled = groups.length === 0;
  $('build-note').textContent = groups.length === 0
    ? '읽어들인 대화가 없습니다.'
    : `${parsed.messages.length}개 메시지 — ${groups.length}일치로 나뉩니다. 하루씩 영어로 옮깁니다.`;
}

$('go-days').addEventListener('click', () => {
  const roomType = guessRoomType(parsed);
  const groups = groupByDay(parsed);
  const existing = new Map(state.days.map((d) => [d.date, d]));
  state.days = groups.map((g) => {
    const old = existing.get(g.date);
    if (old && old.built) return old;                 // keep translations already paid for
    return { date: g.date, roomType, built: false, messages: g.messages, cards: [] };
  });
  save();
  renderDays();
  show('days');
});

/* ══════ day list ══════ */
const dayStatus = (d) =>
  !d.built ? 'new'
  : d.cards.length && d.cards.every((c) => isLearned(c.srs)) ? 'done'
  : 'ready';

function renderDays() {
  const total = state.days.reduce((a, d) => a + (d.cards.length || 0), 0);
  const finished = state.days.filter((d) => dayStatus(d) === 'done').length;
  $('days-sub').textContent = `${state.days.length}일치 · 카드 ${total}개 · 완료 ${finished}일`;

  $('day-list').innerHTML = state.days.map((d, i) => {
    const st = dayStatus(d);
    const label = st === 'done' ? '완료' : st === 'ready' ? '이어서' : '아직 안 옮김';
    const n = d.built ? `${d.cards.length}장` : `${d.messages.length}줄`;
    return `<button class="day ${st}" data-i="${i}">
      <i class="pip"></i>
      <span class="when"><b>${esc(d.date)}</b><span>${label}</span></span>
      <span class="n">${n}</span>
    </button>`;
  }).join('');
  for (const b of $('day-list').querySelectorAll('.day')) {
    b.addEventListener('click', () => openDay(+b.dataset.i));
  }
}

async function openDay(i) {
  activeDay = i;
  const d = state.days[i];
  if (d.built) { renderTranscript(); return; }
  await build(d);
}

/* ══════ build ══════ */
$('build-retry').addEventListener('click', () => build(state.days[activeDay]));
$('build-back').addEventListener('click', () => { renderDays(); show('days'); });

/* Lines per call. A day usually fits in one; long days are cut into slices that
   overlap, so a slice is never dropped into the middle of a conversation. */
const SLICE = 60;
const OVERLAP = 6;

async function build(day) {
  show('build');
  $('build-retry').classList.add('hide');
  $('build-back').classList.add('hide');
  $('build-spin').classList.remove('hide');
  $('build-title').textContent = '영어로 옮기는 중';
  $('build-sub').textContent = `${day.date} · ${day.messages.length}줄`;
  $('build-bar').style.width = '0%';
  $('build-count').textContent = '';

  const todo = day.messages.filter((m) => !m.media);

  if (state.usingSample) {
    for (const m of todo) {
      const hit = SAMPLE_EN[m.ko];
      m.en = hit ? hit[0] : m.ko;
      m.situation = hit ? hit[1] : '대화';
    }
    day.built = true;
    $('build-bar').style.width = '100%';
    save();
    renderTranscript();
    return;
  }

  if (T.provider() === 'none') {
    $('build-spin').classList.add('hide');
    $('build-title').textContent = '번역할 방법이 없습니다';
    $('build-sub').textContent = T.messageFor('no_provider');
    $('build-back').classList.remove('hide');
    return;
  }

  try {
    for (let i = 0; i < todo.length; i += SLICE) {
      const chunk = todo.slice(i, i + SLICE);
      const ref = todo.slice(Math.max(0, i - OVERLAP), i).map((m) => ({ ...m, ref: true }));
      $('build-count').textContent = `${Math.min(i + SLICE, todo.length)} / ${todo.length}`;

      const rows = await T.translateDay([...ref, ...chunk], day.roomType);
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      for (const m of chunk) {
        const r = byId.get(m.id) || {};
        m.en = typeof r.en === 'string' && r.en.trim() ? r.en.trim() : '—';
        m.situation = typeof r.situation === 'string' && r.situation.trim() ? r.situation.trim() : '대화';
      }
      $('build-bar').style.width = Math.round(((i + chunk.length) / todo.length) * 100) + '%';
    }
  } catch (e) {
    const partial = todo.filter((m) => m.en).length;
    $('build-spin').classList.add('hide');
    $('build-title').textContent = partial ? `${partial}줄까지 옮겼습니다` : '번역을 마치지 못했습니다';
    $('build-sub').textContent = T.messageFor(e && e.code);
    $('build-back').classList.remove('hide');
    if (partial) {
      // Keep what was paid for; the untranslated tail is dropped rather than
      // shown as a hole in the conversation.
      day.messages = day.messages.filter((m) => m.en);
      day.built = true;
      save();
      setTimeout(renderTranscript, 1000);
    } else {
      $('build-retry').classList.remove('hide');
    }
    return;
  }

  day.built = true;
  save();
  renderTranscript();
}

/* ══════ transcript — the conversation, in English ══════ */
/* This is the app's first feature standing on its own: yesterday's group chat,
   readable end to end in English. It is also where I say which one is me, which
   only became possible once the English existed (D19). */
function renderTranscript() {
  const day = state.days[activeDay];
  $('tx-title').textContent = day.date;
  $('tx-sub').textContent = state.roomTitle ? `${state.roomTitle} · ${day.messages.length}줄` : `${day.messages.length}줄`;

  // Which name is mine is the one thing the app cannot work out for itself, so
  // it asks — but only until it has an answer. After that the question collapses
  // to a line, because the screen belongs to the conversation, not to the form.
  const people = speakersIn(day.messages);
  const picked = state.me && people.some((p) => p.name === state.me);
  $('tx-pick').classList.toggle('slim', !!picked);
  $('tx-pick').innerHTML = picked
    ? `<div class="whoami"><span>나는 <b>${esc(state.me)}</b></span>
         <button class="linkbtn" id="tx-change">바꾸기</button></div>`
    : `<h2>어느 쪽이 나인가요?</h2>
       <p class="small">고른 사람의 말이 카드가 됩니다. 나머지는 맥락으로 쓰여요.</p>
       <div class="pickers">${people.map((s) => `
         <label class="picker">
           <input type="radio" name="me" value="${esc(s.name)}">
           <span class="nm">${esc(s.name)}</span><span class="ct">${s.count}줄</span>
         </label>`).join('')}</div>`;

  const change = $('tx-change');
  if (change) change.addEventListener('click', () => { state.me = null; save(); renderTranscript(); });
  for (const r of $('tx-pick').querySelectorAll('input')) {
    r.addEventListener('change', () => { state.me = r.value; save(); renderTranscript(); });
  }

  $('tx-body').innerHTML = day.messages.map((m) => {
    const mine = m.speaker === state.me;
    if (m.media) {
      return `<div class="bub media"><span class="who">${esc(m.speaker)}</span>(${esc(m.ko)})</div>`;
    }
    return `<div class="bub ${mine ? 'mine' : ''}" data-en="${esc(m.en || '')}">` +
      `<span class="who">${esc(m.speaker)}</span>` +
      `<span class="en-line">${esc(m.en || '—')}</span>` +
      `<span class="ko-line">${esc(m.ko)}</span></div>`;
  }).join('');

  // Tapping a line reads it. The transcript is the first place someone meets
  // these sentences, so it is the first place they should be able to hear them.
  if (speaker.available()) {
    $('tx-body').classList.add('speakable');
    for (const el of $('tx-body').querySelectorAll('.bub[data-en]')) {
      if (!el.dataset.en) continue;
      el.addEventListener('click', () => {
        for (const b of $('tx-body').querySelectorAll('.bub.playing')) b.classList.remove('playing');
        el.classList.add('playing');
        speaker.speak(el.dataset.en).then(() => el.classList.remove('playing'));
      });
    }
  }

  const n = state.me ? cardsForSpeaker(day.messages, state.me).length : 0;
  $('go-practice').disabled = n === 0;
  $('go-practice').textContent = n ? `내 말 ${n}장 연습하기` : '나를 먼저 골라주세요';
  show('transcript');
}

$('back-transcript').addEventListener('click', () => { renderDays(); show('days'); });
$('go-practice').addEventListener('click', () => {
  const day = state.days[activeDay];
  const fresh = cardsForSpeaker(day.messages, state.me);
  // Rebuilding must not reset what FSRS already knows about a card.
  const old = new Map((day.cards || []).map((c) => [c.id, c.srs]));
  day.cards = fresh.map((c) => ({ ...c, srs: old.get(c.id) || newCardState() }));
  save();
  startSession();
});

/* ══════ practice ══════ */
deck = createSwipeDeck($('deck'), { render: renderCard, onSwipe, onEmpty: finish });

function startSession() {
  const day = state.days[activeDay];
  const main = day.cards.map((_, i) => ({ d: activeDay, i, review: false }));

  // A few cards from earlier days that FSRS says are due, so yesterday's work
  // resurfaces without burying today's.
  const older = [];
  state.days.forEach((dd, di) => {
    if (di === activeDay || !dd.built) return;
    (dd.cards || []).forEach((c, ci) => { if (c.srs.reps > 0 && isDue(c.srs)) older.push({ d: di, i: ci, review: true }); });
  });

  const items = [...main, ...older.slice(0, 8)];
  sessionTotal = items.length;
  sessionDone = 0;
  show('practice');
  deck.load(items);
  updateProgress();
  deck.focus();
}

const cardAt = (ref) => state.days[ref.d].cards[ref.i];

function renderCard(body, ref) {
  const c = cardAt(ref);
  // Context is English now: the card is an English conversation with my turn
  // missing, which is what I am about to fill in out loud.
  const ctx = (c.context || []).map((x) =>
    `<div class="bub ${x.mine ? 'mine' : ''}">` +
    `<span class="who">${esc(x.speaker)}</span>` +
    esc(x.en || x.ko) + '</div>').join('');

  body.innerHTML =
    `<div class="tags"><span class="tag">${esc(c.situation || '대화')}</span>` +
    (ref.review ? '<span class="tag rev">복습</span>' : '') + '</div>' +
    `<div class="ctx">${ctx}</div>` +
    `<div class="target">${esc(c.ko)}</div>` +
    '<div class="answer hide">' +
      '<div class="en-row">' +
        `<div class="en">${esc(c.en || '—')}</div>` +
        (speaker.available()
          ? '<button class="say" data-no-drag aria-label="영어 문장 듣기">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>' +
            '</svg></button>'
          : '') +
      '</div>' +
      '<div class="heard hide"></div><div class="score hide"></div><div class="miss-words hide"></div>' +
    '</div>' +
    '<button class="flip" data-no-drag>정답 보기</button>';

  body.querySelector('.flip').addEventListener('click', () => revealIn(body));
  const say = body.querySelector('.say');
  if (say) say.addEventListener('click', () => speak(say, c.en));
}

function revealIn(body) {
  body.querySelector('.answer').classList.remove('hide');
  const flip = body.querySelector('.flip');
  if (flip) flip.remove();
  $('pr-hint').textContent = '말할 수 있었으면 오른쪽, 아니면 왼쪽으로';
  // Hearing it is most of the point of revealing it, so it plays without asking.
  // The button is still there to hear it again.
  const say = body.querySelector('.say');
  const ref = deck.current();
  if (say && ref) speak(say, cardAt(ref).en);
}

/** Speak a line and show it playing. One utterance at a time. */
function speak(btn, text) {
  if (!speaker.available() || !text) return;
  for (const b of document.querySelectorAll('.say.playing')) b.classList.remove('playing');
  btn.classList.add('playing');
  speaker.speak(text).then(() => btn.classList.remove('playing'));
}

const frontBody = () => $('deck').querySelector('.swipe-card.front .swipe-body');

function onSwipe(ref, dir) {
  const c = cardAt(ref);
  const revealed = !!$('deck').querySelector('.swipe-card.front .answer:not(.hide)');
  // Needing the answer is not the same as producing it: a revealed card that you
  // swipe right is Hard, not Good.
  c.srs = review(c.srs, dir === 'left' ? 'again' : revealed ? 'hard' : 'good');
  if (dir === 'right') sessionDone++;
  heardText = '';
  save();
  updateProgress();
  $('pr-hint').textContent = deck.remaining() > 0
    ? '카드를 눌러 정답을 보고, 오른쪽으로 넘기면 외운 것'
    : '';
}

function updateProgress() {
  const swiped = sessionTotal - deck.remaining();
  $('pr-bar').style.width = (sessionTotal ? (swiped / sessionTotal) * 100 : 0) + '%';
  $('pr-count').textContent = `${swiped}/${sessionTotal}`;
}

$('sw-no').addEventListener('click', () => deck.swipe('left'));
$('sw-yes').addEventListener('click', () => deck.swipe('right'));
$('quit').addEventListener('click', finish);

function finish() {
  stopListening();
  speaker.stop();
  save();
  const day = state.days[activeDay];
  const left = state.days.findIndex((d, i) => i !== activeDay && dayStatus(d) !== 'done');
  const learned = day && day.cards ? day.cards.filter((c) => isLearned(c.srs)).length : 0;

  $('done-eyebrow').textContent = day ? day.date : '세션';
  $('done-title').textContent = sessionDone > 0 ? '오늘치 끝' : '세션 종료';
  $('done-stats').innerHTML = [
    ['외운 카드', sessionDone],
    ['이 날 익힘', learned],
    ['남은 날짜', state.days.filter((d) => dayStatus(d) !== 'done').length],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

  const soonest = day && day.cards && day.cards.length ? dueLabel(day.cards[0].srs) : '';
  $('done-sub').textContent = soonest
    ? `왼쪽으로 넘긴 카드는 더 자주 돌아옵니다. 다음 복습은 ${soonest}.`
    : '왼쪽으로 넘긴 카드는 더 자주 돌아옵니다.';

  $('next-day').classList.toggle('hide', left < 0);
  if (left >= 0) {
    $('next-day').textContent = '다음 날짜 이어서 하기';
    $('next-day').onclick = () => openDay(left);
  }
  show('done');
}

$('see-transcript').addEventListener('click', () => renderTranscript());
$('pick-day').addEventListener('click', () => { renderDays(); show('days'); });
$('restart').addEventListener('click', () => { paste.value = ''; $('go-parse').disabled = true; show('import'); });

/* ══════ speech ══════ */
recog = createRecogniser({
  onPartial: (t) => { heardText = t; $('pr-hint').textContent = t || '…'; },
  onEnd: (t) => {
    listening = false;
    $('mic').classList.remove('live');
    heardText = t || heardText;
    if (heardText) judge();
  },
  onError: (err) => {
    listening = false;
    $('mic').classList.remove('live');
    $('pr-hint').textContent = err === 'not-allowed'
      ? '마이크 권한이 필요합니다. 카드를 눌러 정답을 봐도 됩니다.'
      : '잘 들리지 않았습니다. 다시 눌러보세요.';
  },
});

recog.available().then((ok) => { $('mic').disabled = !ok; });

$('mic').addEventListener('click', async () => {
  if ($('mic').disabled || !deck.current()) return;
  if (listening) { await stopListening(); return; }
  heardText = '';
  listening = true;
  $('mic').classList.add('live');
  $('pr-hint').textContent = '듣고 있습니다… 다 말하면 다시 누르세요';
  await recog.start();
});

async function stopListening() {
  if (listening) await recog.stop();
  listening = false;
  $('mic').classList.remove('live');
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);

function judge() {
  const ref = deck.current();
  const body = frontBody();
  if (!ref || !body) return;
  const c = cardAt(ref);
  const target = norm(c.en);
  const pool = norm(heardText);
  let hit = 0;
  const missed = [];
  for (const w of target) {
    const at = pool.indexOf(w);
    if (at >= 0) { pool.splice(at, 1); hit++; } else missed.push(w);
  }
  const pct = target.length ? Math.round((hit / target.length) * 100) : 0;

  revealIn(body);
  const heardEl = body.querySelector('.heard');
  heardEl.classList.remove('hide');
  heardEl.innerHTML = `들린 말: <b>${esc(heardText)}</b>`;
  const sc = body.querySelector('.score');
  sc.classList.remove('hide', 'hit', 'miss');
  sc.classList.add(pct >= 70 ? 'hit' : 'miss');
  sc.textContent = pct >= 70 ? `${pct}% 일치 — 통했습니다` : `${pct}% 일치`;
  if (missed.length && pct < 100) {
    const mw = body.querySelector('.miss-words');
    mw.classList.remove('hide');
    mw.innerHTML = '빠진 말: ' + missed.slice(0, 8).map((w) => `<u>${esc(w)}</u>`).join(' ');
  }
  $('pr-hint').textContent = pct >= 70 ? '통했으면 오른쪽으로 넘기세요' : '아쉬우면 왼쪽으로 넘기세요';
}

/* ══════ settings ══════ */
$('go-settings').addEventListener('click', openSettings);
$('back-settings').addEventListener('click', () => { refreshHome(); show('home'); });

function openSettings() {
  const p = T.provider();
  $('prov-state').textContent = p === 'claude'
    ? 'Claude 아티팩트로 열려 있어 키 없이 번역됩니다. 아래 설정은 자체 배포용입니다.'
    : p === 'apikey' ? '저장된 API 키를 사용합니다.'
    : '아직 번역할 방법이 없습니다. 아래에 키를 넣거나, Claude 아티팩트로 여세요.';
  $('apikey').value = T.getKey();
  $('model').innerHTML = T.MODELS
    .map((m) => `<option value="${m.id}" ${m.id === T.getModel() ? 'selected' : ''}>${m.label}</option>`).join('');
  const cards = state.days.reduce((a, d) => a + (d.cards.length || 0), 0);
  $('data-state').textContent = state.days.length
    ? `${state.days.length}일치 대화와 카드 ${cards}개가 이 브라우저에 저장돼 있습니다.`
    : '저장된 대화가 없습니다.';
  show('settings');
}

$('save-key').addEventListener('click', () => {
  T.setKey($('apikey').value.trim());
  T.setModel($('model').value);
  openSettings();
});

$('wipe').addEventListener('click', () => {
  if (!confirm('저장된 대화와 진도를 모두 지웁니다. 되돌릴 수 없습니다.')) return;
  state = { me: null, roomTitle: null, days: [], usingSample: false };
  try { localStorage.removeItem(STORE); } catch { /* private mode */ }
  parsed = null;
  refreshHome();
  show('home');
});

/* ══════ boot ══════ */
const saved = load();
if (saved) state = { ...state, ...saved };
refreshHome();
show('home');

T.detect().then(refreshHome);

// On the native shell KakaoTalk can share an export straight into the app,
// which skips the file picker the web has to fall back to.
onSharedChatExport((text) => {
  paste.value = text;
  $('go-parse').disabled = text.trim().length < 10;
  ingest(text, false);
});

if (isNative()) document.documentElement.dataset.platform = platform();
