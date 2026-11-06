/**
 * Reading a conversation that someone dragged out of a chat window and pasted.
 *
 * KakaoTalk is the one messenger with an export file, and kakao-parser.js
 * reads it exactly. Everything else at work — Telegram, Slack, Teams, LINE
 * WORKS, 잔디, 네이버웍스, a company's own messenger — only offers "select and
 * copy", and every one of them puts the name and the time somewhere different.
 * Writing a grammar per messenger would be a list that never ends and breaks on
 * every update, so this reads the two shapes they all reduce to:
 *
 *   inline   one message per line, the name in front of a colon
 *              박팀장: 오늘까지 되나요?
 *              [오전 9:15] 박팀장: 오늘까지 되나요?
 *              2026-11-03 09:15 박팀장: 오늘까지 되나요?
 *
 *   blocks   a header line with the name and the time, then the message
 *              박팀장  오전 9:15          (Slack, Teams, 잔디)
 *              박팀장, [2026.11.03 9:15]  (Telegram Desktop)
 *              [오전 9:15] 박팀장
 *              박팀장                      (name on one line, time on the next)
 *              오전 9:15
 *
 * A paste that is neither — bubbles copied off a phone with no names at all —
 * comes back empty, and the app hands the raw text to the model instead
 * (translate.js readChat). The preview screen exists to catch a wrong read
 * from either path before anything is translated.
 */

import { parseKakaoExport } from './kakao-parser.js';

const AMPM = '(?:오전|오후|AM|PM|am|pm|a\\.m\\.|p\\.m\\.)';
const CLOCK = `(?:${AMPM}\\s*)?\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*${AMPM})?`;
const DATE_NUM = '\\d{4}\\s*[.\\-/년]\\s*\\d{1,2}\\s*[.\\-/월]\\s*\\d{1,2}\\s*(?:일|\\.)?';
const DATE_DMY = '\\d{1,2}[.\\-/]\\d{1,2}[.\\-/]\\d{2,4}';
const DATE_KO = '\\d{1,2}월\\s*\\d{1,2}일';
const WEEKDAY = '(?:\\(?\\s*[월화수목금토일](?:요일)?\\s*\\)?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?)';
const DATE = `(?:${DATE_NUM}|${DATE_DMY}|${DATE_KO})(?:\\s*${WEEKDAY})?`;
const STAMP = `(?:${DATE}\\s*,?\\s*)?${CLOCK}`;

// Followed or preceded by a space or a bracket: "9:00에 봬요" is a sentence.
const RE_STAMP_HEAD = new RegExp(`^[\\[(]?\\s*${STAMP}\\s*[\\])]?(?=\\s|$)`);
const RE_STAMP_TAIL = new RegExp(`(?:^|[\\s,\\[(])${STAMP}\\s*[\\])]?\\s*[:：]?$`);
const RE_STAMP_ONLY = new RegExp(`^[\\[(]?\\s*${STAMP}\\s*[\\])]?$`);
const RE_DATE_ONLY = new RegExp(`^[-─=\\s]*(?:${WEEKDAY}\\s*)?${DATE}[\\s,]*(?:${WEEKDAY})?[-─=\\s]*$`);
const RE_TODAY = /^[-─=\s]*(오늘|어제|Today|Yesterday)[-─=\s]*$/i;

/* "[오전 9:15] 박팀장: 말" — stamp optional, before or after the name. */
const RE_INLINE = new RegExp(
  `^\\s*(?:[\\[(]?\\s*(${STAMP})\\s*[\\])]?\\s*[-–|]?\\s*)?` +
  `([^:：\\[\\]\\n]{1,30}?)` +
  `\\s*(?:[\\[(]\\s*(${STAMP})\\s*[\\])])?` +
  `\\s*[:：]\\s*(.+)$`,
);

/* What a messenger adds around a name that is not part of it. */
const EDITED = /\s*(\((edited|수정됨)\)|edited|수정됨)\s*$/i;
const HEADER_NOISE = new RegExp(`${STAMP}|${DATE}|[\\[\\]:：,·|]`, 'g');

/* Lines messengers insert that nobody said. */
const RE_SYSTEM = /(님이 (들어왔|나갔)습니다|님을 초대했습니다|joined the (channel|group)|left the (channel|group)|pinned a message|메시지를 고정|읽음\s*\d*$|^\d+\s*명?\s*읽음$|^새 메시지$|^New messages?$|^Unread messages?$)/i;
const MEDIA = /^(\[?(사진|동영상|이모티콘|스티커|파일|Photo|Image|Video|Sticker|GIF|File)\]?|사진 \d+장|\(이모티콘\))$/i;

/** A name is short, has a letter in it, and does not read like a sentence. */
function nameLike(s) {
  const t = s.trim();
  if (t.length < 1 || t.length > 30) return false;
  if (!/[\p{L}]/u.test(t)) return false;
  if (/[.?!~…'"“”‘’]$/.test(t)) return false;
  if (/^https?$/i.test(t)) return false;
  if (t.split(/\s+/).length > 4) return false;
  // Korean sentence endings: "확인했습니다", "부탁드려요" are messages, not names.
  if (/(니다|어요|아요|해요|세요|네요|군요|죠|까요|데요)$/.test(t)) return false;
  return true;
}

function ampmMinutes(stamp) {
  if (!stamp) return null;
  const m = stamp.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const pm = /오후|PM|pm|p\.m\./.test(stamp);
  const am = /오전|AM|am|a\.m\./.test(stamp);
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return h * 60 + min;
}

/** "2026.11.3", "2026-11-03", "3.11.26", "11월 3일" → "2026년 11월 3일". */
export function koreanDate(s, today = new Date()) {
  if (!s) return null;
  let m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (m) return `${+m[1]}년 ${+m[2]}월 ${+m[3]}일`;
  m = s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (m) {
    // Telegram writes day.month.year; American apps write month/day/year.
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [d, mo] = s.includes('/') ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return `${y}년 ${mo}월 ${d}일`;
  }
  m = s.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (m) return `${today.getFullYear()}년 ${+m[1]}월 ${+m[2]}일`;
  return null;
}

export function todayKorean(today = new Date()) {
  return `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
}

function relativeDate(word, today) {
  const d = new Date(today);
  if (/어제|yesterday/i.test(word)) d.setDate(d.getDate() - 1);
  return todayKorean(d);
}

function finish(messages, format) {
  const kept = messages
    .map((m) => ({ ...m, text: m.text.trim() }))
    .filter((m) => m.text !== '');
  for (const m of kept) m.media = MEDIA.test(m.text);
  const counts = new Map();
  for (const m of kept) counts.set(m.speaker, (counts.get(m.speaker) || 0) + 1);
  const speakers = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { roomTitle: null, speakers, messages: kept, skipped: 0, format };
}

/** One message per line, "이름: 말". */
function readInline(lines, today) {
  const out = [];
  let date = null;
  let hits = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (RE_TODAY.test(t)) { date = relativeDate(t, today); continue; }
    if (RE_DATE_ONLY.test(t)) { date = koreanDate(t, today) || date; continue; }
    if (RE_SYSTEM.test(t)) continue;
    const m = t.match(RE_INLINE);
    // "회의는 3:00에" splits at the clock's colon; a name never ends in the hour.
    const clockSplit = m && /\d$/.test(m[2]) && /^\d{2}/.test(m[4]);
    if (m && !clockSplit && nameLike(m[2]) && !/^\d+$/.test(m[2].trim())) {
      hits++;
      const stamp = m[1] || m[3] || '';
      const d = koreanDate(stamp, today) || date;
      out.push({ speaker: m[2].trim(), text: m[4], date: d, minutes: ampmMinutes(stamp) });
    } else if (out.length) {
      out[out.length - 1].text += '\n' + t;
    }
  }
  return { messages: out, hits };
}

/**
 * A header names who spoke and when; the lines under it are what they said.
 * Each line under a header is its own message: messengers group a run of
 * messages from one person under one header, and a line is the card anyway.
 */
function readBlocks(lines, today) {
  const rows = lines.map((l) => l.trim()).filter(Boolean);
  const isStamp = (t) => RE_STAMP_ONLY.test(t);
  const header = (line) => {
    const t = line.replace(EDITED, '').trim();
    // The time sits at one end of a header, never inside a sentence:
    // "3시 회의는 3:00에" is a message.
    if (t.length > 60 || !(RE_STAMP_HEAD.test(t) || RE_STAMP_TAIL.test(t))) return null;
    const name = t.replace(HEADER_NOISE, ' ').replace(/\s+/g, ' ').trim();
    if (!name || !nameLike(name)) return null;
    const stamp = t.match(new RegExp(STAMP));
    return { name, stamp: stamp ? stamp[0] : '' };
  };

  // "이름" on one line and the time on the next reads exactly like a short
  // message with its time printed under the bubble ("넵 / 오전 9:17"). Only a
  // line that recurs in that position, or already heads a one-line header, is
  // taken for a name.
  const seen = new Map();
  const known = new Set();
  rows.forEach((t, i) => {
    const h = header(t);
    if (h) known.add(h.name);
    if (i + 1 < rows.length && isStamp(rows[i + 1]) && nameLike(t) && t.length <= 20) {
      seen.set(t, (seen.get(t) || 0) + 1);
    }
  });
  // Once one name has shown up that way twice, the paste is in that layout,
  // and a colleague who spoke once is still a name.
  const layout = [...seen.values()].some((c) => c >= 2);
  const twoLine = new Set([...seen.keys()].filter((n) => layout || known.has(n)));

  const out = [];
  let date = null;
  let speaker = null;
  let minutes = null;
  let headers = 0;

  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    if (RE_TODAY.test(t)) { date = relativeDate(t, today); continue; }
    if (RE_DATE_ONLY.test(t)) { date = koreanDate(t, today) || date; continue; }
    if (RE_SYSTEM.test(t)) continue;

    if (twoLine.has(t) && i + 1 < rows.length && isStamp(rows[i + 1])) {
      speaker = t;
      minutes = ampmMinutes(rows[i + 1]);
      date = koreanDate(rows[i + 1], today) || date;
      headers++;
      i++;
      continue;
    }
    // A bare time beside a bubble is when, not what.
    if (isStamp(t)) continue;

    const h = header(t);
    if (h) {
      speaker = h.name;
      minutes = ampmMinutes(h.stamp);
      date = koreanDate(h.stamp, today) || date;
      headers++;
      continue;
    }
    if (speaker) out.push({ speaker, text: t, date, minutes });
  }
  return { messages: out, hits: headers };
}

/**
 * Read any pasted chat. KakaoTalk exports first, because that grammar is exact;
 * then whichever generic shape explains more of the paste.
 *
 * @param {string} raw
 * @param {{today?: Date}} [opts]
 * @returns the same shape as parseKakaoExport, with `format` one of
 *          'android' | 'ios' | 'mixed' (KakaoTalk), 'inline', 'blocks', or
 *          'unknown' with no messages when neither shape fits.
 */
export function parseChat(raw, opts = {}) {
  const today = opts.today || new Date();
  const kakao = parseKakaoExport(raw);
  if (kakao.messages.length > 0 && kakao.format !== 'unknown') return kakao;

  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
  const body = lines.filter((l) => l.trim() !== '').length;
  if (body === 0) return finish([], 'unknown');

  const inline = readInline(lines, today);
  const blocks = readBlocks(lines, today);

  // Inline has to explain most lines: a paste of prose has the odd "참고: …"
  // in it, and that is not a conversation. Blocks need at least two headers,
  // because one name over a paragraph is a quote, not a chat.
  const inlineOk = inline.hits >= 2 && inline.hits / body >= 0.4;
  const blocksOk = blocks.hits >= 2 && blocks.messages.length >= 2;

  if (inlineOk && (!blocksOk || inline.messages.length >= blocks.messages.length)) {
    return finish(inline.messages, 'inline');
  }
  if (blocksOk) return finish(blocks.messages, 'blocks');
  return finish([], 'unknown');
}

/**
 * Normalise what the model read off a screenshot or an unstructured paste into
 * the parser's shape. The model is told to name my bubbles "나"; anything it
 * returns that is not a row with text is dropped rather than trusted.
 */
export function fromModelRows(rows, opts = {}) {
  const today = opts.today || new Date();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.text !== 'string' || !r.text.trim()) continue;
    const speaker = r.mine ? '나' : (typeof r.speaker === 'string' && r.speaker.trim()) || '상대';
    out.push({
      speaker: speaker.slice(0, 30),
      text: r.text,
      date: koreanDate(typeof r.date === 'string' ? r.date : '', today),
      minutes: ampmMinutes(typeof r.time === 'string' ? r.time : ''),
    });
  }
  return finish(out, 'model');
}
