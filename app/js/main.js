import { parseKakaoExport, buildCandidates, guessRoomType, groupByDay } from './kakao-parser.js';
import { newCardState, review, isDue, isLearned, dueLabel } from './srs.js';
import { createSwipeDeck } from './swipe.js';
import * as T from './translate.js';
import { isNative, platform, onSharedChatExport, createRecogniser } from './platform.js';
import { JOB_DECKS } from './job-decks.js';

/* The sample ships with English written in, so the whole loop — including the
   swipe and the scheduler — works before any provider is configured. */
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

const SAMPLE_EN = {
  '팀장님 그거 오늘까지 되나요?': ['Can you get that done by today?', '마감 확인'],
  '지금 QA 돌리고 있습니다': ["I'm running QA on it right now.", '진행 보고'],
  '넵': ['Got it.', '수락'],
  '방금 확인했는데 이슈가 하나 있어서\n좀 늦어질 것 같습니다': ["I just checked and there's an issue, so it's going to run a bit late.", '지연 알림'],
  '두 시간 정도면 될 것 같아요': ['I think about two hours should do it.', '일정 추정'],
  '배포 완료했습니다!': ["The deploy's done!", '완료 보고'],
  '감사합니다 주말 잘 보내세요': ['Thanks — have a good weekend!', '인사'],
  '어 될 것 같은데 몇 시쯤?': ['Yeah, I think so — what time?', '약속 잡기'],
  '좋아 그때 보자': ['Sounds good, see you then.', '약속 확정'],
  '어디서 볼지는 내일 정하자': ["Let's figure out where tomorrow.", '보류'],
};

const STORE = 'rte.v3';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = { me: null, roomTitle: null, days: [], usingSample: false, job: null, seen: false };
let parsed = null;
let activeDay = null;
let deck = null;
let sessionDone = 0;
let sessionTotal = 0;
let heardText = '';
let recog = null;
let listening = false;

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
$('go-resume').addEventListener('click', () => { renderDays(); show('days'); });
$('back-preview').addEventListener('click', () => show('import'));
$('back-days').addEventListener('click', () => show(parsed ? 'preview' : 'home'));

function ingest(raw, isSample) {
  const p = parseKakaoExport(raw);
  if (p.messages.length === 0) {
    $('import-err').textContent =
      '카톡 대화 형식을 찾지 못했습니다. 카톡에서 «대화 내용 내보내기 → 텍스트만»으로 저장한 파일인지 확인해 주세요.';
    return;
  }
  $('import-err').textContent = '';
  parsed = p;
  state.usingSample = isSample;
  state.roomTitle = p.roomTitle;
  state.me = p.speakers[0] ? p.speakers[0].name : null;
  renderPreview();
  show('preview');
}

/* ══════ preview ══════ */
function renderPreview() {
  const days = new Set(parsed.messages.map((m) => m.date).filter(Boolean)).size;
  $('stats').innerHTML = [
    ['메시지', parsed.messages.length],
    ['참여자', parsed.speakers.length],
    ['날짜', days || '—'],
    ['형식', parsed.format === 'android' ? 'Android' : parsed.format === 'ios' ? 'iOS' : parsed.format],
  ].map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${k}</span></div>`).join('');

  $('pickers').innerHTML = parsed.speakers.map((s) => `
    <label class="picker">
      <input type="radio" name="me" value="${esc(s.name)}" ${s.name === state.me ? 'checked' : ''}>
      <span class="nm">${esc(s.name)}</span><span class="ct">${s.count}개</span>
    </label>`).join('');
  for (const r of $('pickers').querySelectorAll('input')) {
    r.addEventListener('change', () => { state.me = r.value; renderTx(); updateNote(); });
  }
  renderTx();
  updateNote();
}

function renderTx() {
  $('preview-tx').innerHTML = parsed.messages.slice(0, 40).map((m) => {
    const mine = m.speaker === state.me;
    return `<div class="bub ${mine ? 'mine' : ''} ${m.media ? 'media' : ''}">` +
      (mine ? '' : `<span class="who">${esc(m.speaker)}</span>`) +
      esc(m.media ? `(${m.text})` : m.text) + '</div>';
  }).join('');
}

function updateNote() {
  const groups = groupByDay(buildCandidates(parsed, state.me));
  const n = groups.reduce((a, d) => a + d.cards.length, 0);
  $('go-days').disabled = n === 0;
  $('build-note').textContent = n === 0
    ? '이 사람의 텍스트 발화가 없습니다. 다른 사람을 골라보세요.'
    : `${state.me}님의 발화 ${n}개 — ${groups.length}일치로 나뉩니다.`;
}

$('go-days').addEventListener('click', () => {
  const roomType = guessRoomType(parsed);
  const groups = groupByDay(buildCandidates(parsed, state.me));
  const existing = new Map(state.days.map((d) => [d.date, d]));
  // Job decks are not days of this chat export, so importing a conversation
  // must not sweep them (and their review history) away.
  const jobs = state.days.filter((d) => d.kind === 'job');
  const chatDays = groups.map((g) => {
    const old = existing.get(g.date);
    if (old && old.built) return old;                 // keep translations already paid for
    return { date: g.date, roomType, built: false, cards: g.cards.map((c) => ({ ...c, srs: newCardState() })) };
  });
  state.days = [...jobs, ...chatDays];
  save();
  renderDays();
  show('days');
});

/* ══════ job decks ══════ */
/* A job deck is just a deck that arrived pre-translated, so it joins state.days
   and reuses the whole practice, scheduling and progress machinery. */
$('go-import').addEventListener('click', () => show('import'));
$('back-home').addEventListener('click', () => { refreshResume(); renderJobs(); show('home'); });

function renderJobs() {
  const ordered = state.job
    ? [...JOB_DECKS].sort((a, b) => (b.id === state.job) - (a.id === state.job))
    : JOB_DECKS;
  $('job-list').innerHTML = ordered.map((d) => {
    const mine = state.days.find((x) => x.jobId === d.id);
    const st = !mine ? 'new' : dayStatus(mine);
    const label = st === 'done' ? '완료' : st === 'ready' ? '이어서' : d.blurb;
    return `<button class="day ${st}" data-job="${esc(d.id)}">
      <i class="pip"></i>
      <span class="when"><b>${esc(d.name)}</b><span>${esc(label)}</span></span>
      <span class="n">${d.cards.length}장</span>
    </button>`;
  }).join('');
  for (const b of $('job-list').querySelectorAll('.day')) {
    b.addEventListener('click', () => openJobDeck(b.dataset.job));
  }
}

function openJobDeck(jobId) {
  const src = JOB_DECKS.find((d) => d.id === jobId);
  if (!src) return;
  state.job = jobId;
  state.seen = true;
  let i = state.days.findIndex((d) => d.jobId === jobId);
  if (i < 0) {
    state.days.unshift({
      kind: 'job',
      jobId: src.id,
      date: `직무 · ${src.name}`,
      roomType: 'business',
      built: true,                       // English ships with the deck
      cards: src.cards.map((c, n) => ({
        id: `${src.id}-${n}`,
        ko: c.ko,
        en: c.en,
        situation: c.situation,
        context: (c.context || []).map((x) => ({ ...x, mine: false })),
        srs: newCardState(),
      })),
    });
    i = 0;
    save();
  }
  activeDay = i;
  save();
  startSession();
}

/* ══════ day list ══════ */
const dayStatus = (d) => !d.built ? 'new' : d.cards.every((c) => isLearned(c.srs)) ? 'done' : 'ready';

function renderDays() {
  const total = state.days.reduce((a, d) => a + d.cards.length, 0);
  const finished = state.days.filter((d) => dayStatus(d) === 'done').length;
  $('days-sub').textContent = `${state.days.length}일치 · 카드 ${total}개 · 완료 ${finished}일`;

  $('day-list').innerHTML = state.days.map((d, i) => {
    const st = dayStatus(d);
    const label = st === 'done' ? '완료' : st === 'ready' ? '이어서' : '아직';
    return `<button class="day ${st}" data-i="${i}">
      <i class="pip"></i>
      <span class="when"><b>${esc(d.date)}</b><span>${label}</span></span>
      <span class="n">${d.cards.length}장</span>
    </button>`;
  }).join('');
  for (const b of $('day-list').querySelectorAll('.day')) {
    b.addEventListener('click', () => openDay(+b.dataset.i));
  }
}

async function openDay(i) {
  activeDay = i;
  const d = state.days[i];
  if (d.built) { startSession(); return; }
  await build(d);
}

/* ══════ build ══════ */
$('build-retry').addEventListener('click', () => build(state.days[activeDay]));
$('build-back').addEventListener('click', () => { renderDays(); show('days'); });

async function build(day) {
  show('build');
  $('build-retry').classList.add('hide');
  $('build-back').classList.add('hide');
  $('build-spin').classList.remove('hide');
  $('build-title').textContent = '영어로 옮기는 중';
  $('build-sub').textContent = `${day.date} · ${day.cards.length}장`;
  $('build-bar').style.width = '0%';
  $('build-count').textContent = '';

  if (state.usingSample) {
    for (const c of day.cards) {
      const hit = SAMPLE_EN[c.ko];
      c.en = hit ? hit[0] : c.ko;
      c.situation = hit ? hit[1] : '대화';
    }
    day.built = true;
    $('build-bar').style.width = '100%';
    save();
    startSession();
    return;
  }

  if (T.provider() === 'none') {
    $('build-spin').classList.add('hide');
    $('build-title').textContent = '번역할 방법이 없습니다';
    $('build-sub').textContent = T.messageFor('no_provider');
    $('build-back').classList.remove('hide');
    return;
  }

  const BATCH = 10;
  try {
    for (let i = 0; i < day.cards.length; i += BATCH) {
      const chunk = day.cards.slice(i, i + BATCH);
      $('build-count').textContent = `${Math.min(i + BATCH, day.cards.length)} / ${day.cards.length}`;
      const rows = await T.translate(chunk, day.roomType);
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      for (const c of chunk) {
        const r = byId.get(c.id) || {};
        c.en = typeof r.en === 'string' && r.en.trim() ? r.en.trim() : '—';
        c.situation = typeof r.situation === 'string' && r.situation.trim() ? r.situation.trim() : '대화';
      }
      $('build-bar').style.width = Math.round(((i + chunk.length) / day.cards.length) * 100) + '%';
    }
  } catch (e) {
    const partial = day.cards.filter((c) => c.en).length;
    $('build-spin').classList.add('hide');
    $('build-title').textContent = partial ? `${partial}장까지 만들었습니다` : '번역을 마치지 못했습니다';
    $('build-sub').textContent = T.messageFor(e && e.code);
    $('build-back').classList.remove('hide');
    if (partial) {
      day.cards = day.cards.filter((c) => c.en);
      day.built = true;
      save();
      setTimeout(startSession, 1000);
    } else {
      $('build-retry').classList.remove('hide');
    }
    return;
  }

  day.built = true;
  save();
  startSession();
}

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
    dd.cards.forEach((c, ci) => { if (c.srs.reps > 0 && isDue(c.srs)) older.push({ d: di, i: ci, review: true }); });
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
  const ctx = (c.context || []).map((x) =>
    `<div class="bub ${x.mine ? 'mine' : ''}">` +
    (x.mine ? '' : `<span class="who">${esc(x.speaker)}</span>`) +
    esc(x.text) + '</div>').join('');

  body.innerHTML =
    `<div class="tags"><span class="tag">${esc(c.situation || '대화')}</span>` +
    (ref.review ? '<span class="tag rev">복습</span>' : '') + '</div>' +
    `<div class="ctx">${ctx}</div>` +
    `<div class="target">${esc(c.ko)}</div>` +
    '<div class="answer hide">' +
      `<div class="en">${esc(c.en || '—')}</div>` +
      '<div class="heard hide"></div><div class="score hide"></div><div class="miss-words hide"></div>' +
    '</div>' +
    '<button class="flip" data-no-drag>정답 보기</button>';

  body.querySelector('.flip').addEventListener('click', () => revealIn(body));
}

function revealIn(body) {
  body.querySelector('.answer').classList.remove('hide');
  const flip = body.querySelector('.flip');
  if (flip) flip.remove();
  $('pr-hint').textContent = '말할 수 있었으면 오른쪽, 아니면 왼쪽으로';
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
  save();
  const day = state.days[activeDay];
  const left = state.days.findIndex((d, i) => i !== activeDay && dayStatus(d) !== 'done');
  const learned = day ? day.cards.filter((c) => isLearned(c.srs)).length : 0;

  $('done-eyebrow').textContent = day ? day.date : '세션';
  $('done-title').textContent = sessionDone > 0 ? '오늘치 끝' : '세션 종료';
  $('done-stats').innerHTML = [
    ['외운 카드', sessionDone],
    ['이 날 익힘', learned],
    ['남은 날짜', state.days.filter((d) => dayStatus(d) !== 'done').length],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

  const soonest = day && day.cards.length ? dueLabel(day.cards[0].srs) : '';
  $('done-sub').textContent = soonest
    ? `왼쪽으로 넘긴 카드는 더 자주 돌아옵니다. 다음 복습은 ${soonest}.`
    : '왼쪽으로 넘긴 카드는 더 자주 돌아옵니다.';

  $('next-day').classList.toggle('hide', left < 0);
  if (left >= 0) {
    const nxt = state.days[left];
    $('next-day').textContent = nxt.kind === 'job' ? `${nxt.date} 이어서 하기` : '다음 날짜 이어서 하기';
    $('next-day').onclick = () => openDay(left);
  }
  show('done');
}

$('pick-day').addEventListener('click', () => { renderDays(); show('days'); });
$('more-jobs').addEventListener('click', () => { refreshResume(); renderJobs(); show('home'); });
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
$('back-settings').addEventListener('click', () => show('home'));

function openSettings() {
  const p = T.provider();
  $('prov-state').textContent = p === 'claude'
    ? 'Claude 아티팩트로 열려 있어 키 없이 번역됩니다. 아래 설정은 자체 배포용입니다.'
    : p === 'apikey' ? '저장된 API 키를 사용합니다.'
    : '아직 번역할 방법이 없습니다. 아래에 키를 넣거나, Claude 아티팩트로 여세요.';
  $('apikey').value = T.getKey();
  $('model').innerHTML = T.MODELS
    .map((m) => `<option value="${m.id}" ${m.id === T.getModel() ? 'selected' : ''}>${m.label}</option>`).join('');
  const cards = state.days.reduce((a, d) => a + d.cards.length, 0);
  $('data-state').textContent = cards
    ? `${state.days.length}일치 · 카드 ${cards}개가 이 브라우저에 저장돼 있습니다.`
    : '저장된 카드가 없습니다.';
  show('settings');
}

$('save-key').addEventListener('click', () => {
  T.setKey($('apikey').value.trim());
  T.setModel($('model').value);
  openSettings();
});

$('wipe').addEventListener('click', () => {
  if (!confirm('저장된 카드와 진도를 모두 지웁니다. 되돌릴 수 없습니다.')) return;
  state = { me: null, roomTitle: null, days: [], usingSample: false, job: null, seen: false };
  try { localStorage.removeItem(STORE); } catch { /* private mode */ }
  parsed = null;
  refreshResume();
  renderJobs();
  show('welcome');
});

/* ══════ welcome ══════ */
/* First run asks one question — what do you do — and answering it drops you
   straight into a deck. Anything more elaborate is a wall in front of the
   thing people came to do. */
function renderWelcome() {
  $('welcome-jobs').innerHTML = JOB_DECKS.map((d) => `<button class="day" data-job="${esc(d.id)}">
      <i class="pip"></i>
      <span class="when"><b>${esc(d.name)}</b><span>${esc(d.blurb)}</span></span>
      <span class="n">${d.cards.length}장</span>
    </button>`).join('');
  for (const b of $('welcome-jobs').querySelectorAll('.day')) {
    b.addEventListener('click', () => openJobDeck(b.dataset.job));
  }
}

$('welcome-skip').addEventListener('click', () => {
  state.seen = true;
  save();
  show('import');
});

/* ══════ boot ══════ */
function refreshResume() {
  const remaining = state.days.filter((d) => dayStatus(d) !== 'done').length;
  $('go-resume').classList.toggle('hide', !state.days.length);
  $('go-resume').textContent = remaining ? `이어서 하기 · ${remaining}일 남음` : `복습하기 · ${state.days.length}일치`;
}

const saved = load();
if (saved) state = { ...state, ...saved };
refreshResume();
renderJobs();
renderWelcome();
show(saved ? 'home' : 'welcome');

T.detect();

// On the native shell KakaoTalk can share an export straight into the app,
// which is the whole reason the shell exists on iOS — Safari cannot register as
// a share target at all.
onSharedChatExport((text) => {
  paste.value = text;
  $('go-parse').disabled = false;
  ingest(text, false);
});

if (isNative()) document.documentElement.dataset.platform = platform();

// Only meaningful when served from its own origin; inside the artifact frame
// there is no scope to register against.
if ('serviceWorker' in navigator && window.top === window.self && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}
