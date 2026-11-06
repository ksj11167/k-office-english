/**
 * Turning a day of Korean conversation into English, wherever the app runs.
 *
 * Two providers, picked automatically:
 *
 *   proxy   — a PROXY_URL is configured, so the server holds the key and the
 *             user supplies nothing. This is the path an ordinary user takes;
 *             the other two exist so the app also works without a server.
 *   claude  — the page is a published Claude artifact, so `claude.use("sample")`
 *             asks the viewer's own Claude. No key, no setup.
 *   apikey  — the page is self-hosted (GitHub Pages, a static host), so the user
 *             supplies their own Anthropic key. Anthropic only accepts browser
 *             requests when they opt in with the
 *             `anthropic-dangerous-direct-browser-access` header; the key stays
 *             in this browser and is never sent anywhere but api.anthropic.com.
 *
 * With neither, translation is unavailable and the app falls back to the sample
 * deck, which ships with English already written.
 */

const KEY_STORE = 'rte.apikey';
const MODEL_STORE = 'rte.model';

/* Set at deploy time. Empty means this build has no server of its own and falls
   back to the artifact capability or the user's own key. */
export const PROXY_URL = '';

export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5 · 가장 정확' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 · 균형' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 · 가장 저렴' },
];

let sampleFn = null;

/** Resolve the artifact capability once; absence is normal, not an error. */
export async function detect() {
  try {
    sampleFn = (await window.claude?.use?.('sample')) || null;
  } catch {
    sampleFn = null;
  }
  return provider();
}

export function provider() {
  // A user's own key wins over the shared proxy: they are paying for it, they
  // get no daily limit, and it is the only way to choose a model.
  if (getKey()) return 'apikey';
  if (sampleFn) return 'claude';
  if (PROXY_URL) return 'proxy';
  return 'none';
}

export const getKey = () => {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
};
export const setKey = (v) => {
  try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch { /* private mode */ }
};
export const getModel = () => {
  try { return localStorage.getItem(MODEL_STORE) || MODELS[0].id; } catch { return MODELS[0].id; }
};
export const setModel = (v) => {
  try { localStorage.setItem(MODEL_STORE, v); } catch { /* private mode */ }
};

/**
 * Translate one slice of a day's conversation.
 *
 * Every line is translated, not only mine (D18). That is what produces an
 * English conversation with my turn in it, which is both what a card's context
 * shows and the only material a roleplay could later run on.
 *
 * `ref` lines are read but not translated: when a day is too long for one call,
 * each slice after the first carries the tail of the one before it so the model
 * is never dropped into the middle of a conversation with no idea what "그거"
 * refers to.
 *
 * @param {{id: string, speaker: string, ko: string, ref?: boolean}[]} slice
 * @param {'business'|'casual'} roomType
 * @returns {Promise<{id: string, en: string, situation: string}[]>}
 */
export async function translateDay(slice, roomType) {
  const prompt = buildPrompt(slice, roomType);
  const p = provider();
  if (p === 'apikey') return viaApi(prompt);
  if (p === 'claude') return viaSample(prompt);
  if (p === 'proxy') return viaProxy(prompt);
  throw { code: 'no_provider', message: 'No translation provider configured' };
}

/**
 * Read a conversation the parser could not: screenshots, or a paste with no
 * names in it (bubbles dragged off a phone). The model returns who said what;
 * the app treats it exactly like a parsed paste from there on, preview first.
 *
 * Screenshots carry the one fact a paste never does — which bubbles are mine,
 * because they sit on the right — so the model is asked to mark them, and the
 * app names that speaker "나".
 *
 * @param {{text?: string, images?: {media_type: string, data: string}[]}} input
 * @returns {Promise<{speaker?: string, text: string, mine?: boolean, time?: string, date?: string}[]>}
 */
export async function readChat(input) {
  const images = input.images || [];
  const prompt = images.length ? shotPrompt(images.length) : pastePrompt(input.text || '');
  const p = provider();
  if (p === 'apikey') return viaApi(prompt, images);
  if (p === 'proxy') return viaProxy(prompt, images);
  if (p === 'claude') {
    // The artifact capability takes text only.
    if (images.length) throw { code: 'no_vision', message: 'artifact sampling has no image input' };
    return viaSample(prompt);
  }
  throw { code: 'no_provider', message: 'No translation provider configured' };
}

const ROW_RULES =
  '- 사진, 이모티콘, 스티커, 파일, 입장·퇴장 같은 시스템 알림, 읽음 숫자는 넣지 마라.\n' +
  '- text는 보이는 그대로. 고치거나 요약하거나 번역하지 마라.\n' +
  '- 시간이 보이면 time에 "오전 9:15" 꼴로, 날짜 구분선이 보이면 그 뒤 줄들의 date에 "2026-11-03" 꼴로. 없으면 빼라.\n' +
  '- 오직 JSON 배열만 출력한다. 대화 순서대로.\n';

function shotPrompt(n) {
  return `메신저 대화 화면 캡처 ${n}장이다. 화면에 보이는 대화를 말 하나씩 JSON으로 옮긴다.\n\n` +
    '규칙:\n' +
    '- 오른쪽에 붙은 말풍선은 이 캡처를 찍은 사람이 보낸 말이다. "mine": true.\n' +
    '- 왼쪽 말풍선은 위에 보이는 이름을 speaker로. 이름이 안 보이면 바로 앞 왼쪽 말풍선과 같은 사람이다. 끝까지 모르면 "상대".\n' +
    '- 말풍선 하나가 말 하나다. 한 말풍선 안의 줄바꿈은 그대로 둔다.\n' +
    '- 캡처끼리 겹치는 부분은 한 번만 넣는다. 캡처 순서가 뒤섞였으면 시간과 겹치는 말을 보고 대화 순서를 맞춘다.\n' +
    '- 화면 맨 위 대화방 이름, 입력창, 메뉴 글자는 넣지 마라.\n' +
    ROW_RULES + '\n' +
    '[{"speaker":"박팀장","text":"오늘까지 되나요?","time":"오전 9:15"},{"text":"넵 확인해볼게요","mine":true}]';
}

function pastePrompt(text) {
  return '아래는 메신저 채팅창에서 드래그해 복사한 대화다. 누가 무슨 말을 했는지 말 하나씩 JSON으로 옮긴다.\n\n' +
    '규칙:\n' +
    '- 이름이 보이면 그 이름을 speaker로. 이름이 하나도 없으면 말투와 흐름으로 사람을 나눠 "A", "B"로.\n' +
    '- 이름·시간·날짜만 있는 줄은 말이 아니다. 그 정보는 다음 말에 붙인다.\n' +
    ROW_RULES + '\n' +
    '[{"speaker":"박팀장","text":"오늘까지 되나요?","time":"오전 9:15"}]\n\n' +
    '대화:\n' + text.slice(0, 60_000);
}

function buildPrompt(slice, roomType) {
  const items = slice.map((m) => {
    const row = { id: m.id, speaker: m.speaker, ko: m.ko };
    if (m.ref) row.ref = true;
    return row;
  });
  const register = roomType === 'business'
    ? '직장 동료·상사와 쓰는 정중하지만 딱딱하지 않은 영어'
    : '친구끼리 쓰는 편안한 구어체 영어';

  return '한국어 메신저 대화를 영어로 옮긴다. 대화 전체가 영어로 읽혀야 한다.\n\n' +
    '규칙:\n' +
    '- ref가 없는 줄은 **전부** 번역한다. 한 줄도 건너뛰지 마라.\n' +
    '- ref: true인 줄은 앞선 맥락이다. 읽기만 하고 결과에 넣지 마라.\n' +
    `- 말투: ${register}. 교과서 문장이 아니라 실제로 입에서 나오는 말로.\n` +
    '- 대화 전체를 읽고 옮긴다. "그거", "이거"는 영어에서도 that, this로 유지한다.\n' +
    '  뭘 가리키는지 억지로 밝히지 마라.\n' +
    '- "넵", "ㅇㅇ" 같은 짧은 반응도 영어에서 실제로 쓰는 대응 표현을 준다.\n' +
    '- 한 줄당 영어 한 문장. 후보를 나열하지 마라.\n' +
    '- situation: 그 줄의 기능을 한국어 2~6자로. 예) 마감 확인, 사과, 약속 잡기\n\n' +
    '오직 JSON 배열만 출력한다. ref가 아닌 줄과 개수가 같아야 한다:\n' +
    '[{"id":"m3","en":"Can you get that done by today?","situation":"마감 확인"}]\n\n' +
    JSON.stringify(items, null, 1);
}

/** The shared server holds the key; this end sends only the prompt. */
async function viaProxy(prompt, images = []) {
  let res;
  try {
    res = await fetch(PROXY_URL.replace(/\/$/, '') + '/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(images.length ? { prompt, images } : { prompt }),
    });
  } catch {
    throw { code: 'upstream_error', message: 'network' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { code: data.error || 'upstream_error', message: `HTTP ${res.status}` };
  return parseRows(String(data.text || ''));
}

async function viaSample(prompt) {
  const rows = await sampleFn.json(prompt, { modelTier: 'default' });
  return Array.isArray(rows) ? rows : [];
}

async function viaApi(prompt, images = []) {
  const content = images.length
    ? [
      ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
      { type: 'text', text: prompt },
    ]
    : prompt;
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': getKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 8192,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch {
    throw { code: 'upstream_error', message: 'network' };
  }

  if (!res.ok) {
    const code = res.status === 401 ? 'not_granted'
      : res.status === 429 ? 'rate_limited'
      : res.status === 400 ? 'invalid_request'
      : 'upstream_error';
    throw { code, message: `HTTP ${res.status}` };
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return parseRows(text);
}

/** The model is asked for a bare array, but tolerate a fence or stray prose. */
function parseRows(text) {
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(text);
  if (!v) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) v = tryParse(fence[1]);
  }
  if (!v) {
    const a = text.indexOf('[');
    const b = text.lastIndexOf(']');
    if (a >= 0 && b > a) v = tryParse(text.slice(a, b + 1));
  }
  if (!Array.isArray(v)) throw { code: 'invalid_json', message: 'no JSON array in reply', text };
  return v;
}

/** Viewer-facing copy for a failure code. */
export function messageFor(code) {
  switch (code) {
    case 'no_provider': return 'API 키를 넣거나, Claude 아티팩트로 열어야 번역할 수 있습니다.';
    case 'daily_limit': return '오늘 무료 번역 횟수를 다 썼습니다. 내일 다시 되고, 설정에 본인 API 키를 넣으면 제한이 없습니다.';
    case 'origin_not_allowed': return '이 주소에서는 번역 서버를 쓸 수 없습니다.';
    case 'not_granted': return 'API 키가 거부됐습니다. 설정에서 다시 확인해 주세요.';
    case 'rate_limited': return '요청이 한도를 넘었습니다. 잠시 뒤 다시 시도해 주세요.';
    case 'session_expired': return 'claude.ai에 다시 로그인한 뒤 시도해 주세요.';
    case 'prompt_too_large': return '한 번에 보내기에 너무 깁니다. 나눠서 가져와 주세요.';
    case 'no_vision': return '여기서는 캡처를 읽을 수 없습니다. 설정에 API 키를 넣거나, 대화를 복사해서 붙여넣어 주세요.';
    case 'invalid_json': return '응답 형식이 어긋났습니다. 다시 시도해 주세요.';
    case 'invalid_request': return '요청이 거부됐습니다. 모델 이름과 키를 확인해 주세요.';
    case 'refused': return 'Claude가 이 내용의 번역을 거절했습니다.';
    default: return '연결이 끊겼습니다.';
  }
}
