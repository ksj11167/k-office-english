import assert from 'node:assert/strict';
import { parseChat, fromModelRows, koreanDate } from './chat-parser.js';

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

const TODAY = new Date(2026, 10, 6);   // 2026년 11월 6일
const read = (s) => parseChat(s, { today: TODAY });
const lines = (p) => p.messages.map((m) => `${m.speaker}|${m.text}`);

test('kakao export still goes through the exact parser', () => {
  const p = read('[박팀장] [오전 9:12] 배포 어떻게 됐어요?\n[김세진] [오전 9:15] 지금 QA 중입니다');
  assert.equal(p.format, 'android');
  assert.equal(p.messages.length, 2);
});

test('inline: plain "이름: 말" lines', () => {
  const p = read('박팀장: 오늘까지 되나요?\n김세진: 넵 확인하고 말씀드릴게요\n박팀장: 부탁해요');
  assert.equal(p.format, 'inline');
  assert.deepEqual(lines(p), ['박팀장|오늘까지 되나요?', '김세진|넵 확인하고 말씀드릴게요', '박팀장|부탁해요']);
});

test('inline: bracketed time in front, time-colon not mistaken for the name colon', () => {
  const p = read('[오전 9:15] 박팀장: 회의 3:00에 해요\n[오전 9:16] 김세진: 넵 알겠습니다');
  assert.deepEqual(lines(p), ['박팀장|회의 3:00에 해요', '김세진|넵 알겠습니다']);
  assert.equal(p.messages[0].minutes, 9 * 60 + 15);
});

test('inline: full date and 24h time in front', () => {
  const p = read('2026-11-03 14:05 박팀장: 자료 보내주세요\n2026-11-03 14:07 김세진: 지금 보낼게요');
  assert.equal(p.messages[0].date, '2026년 11월 3일');
  assert.equal(p.messages[0].minutes, 14 * 60 + 5);
});

test('inline: wrapped line continues the message above', () => {
  const p = read('박팀장: 내일 회의는\n오후로 미룰게요\n김세진: 넵');
  assert.equal(p.messages[0].text, '내일 회의는\n오후로 미룰게요');
  assert.equal(p.messages.length, 2);
});

test('blocks: Slack-style "이름  오전 9:15" headers, one message per line', () => {
  const p = read(`박팀장  오전 9:15
배포 건 어떻게 됐어요?
오늘까지 되나요?
김세진  오전 9:17
지금 QA 돌리는 중입니다
박팀장  오전 9:18
넵 부탁해요`);
  assert.equal(p.format, 'blocks');
  assert.deepEqual(lines(p), [
    '박팀장|배포 건 어떻게 됐어요?', '박팀장|오늘까지 되나요?',
    '김세진|지금 QA 돌리는 중입니다', '박팀장|넵 부탁해요',
  ]);
  assert.equal(p.messages[2].minutes, 9 * 60 + 17);
});

test('blocks: English UI "Name 9:15 AM" with an (edited) mark', () => {
  const p = read('Jihoon Park 9:15 AM\nCan you check the PR?\nSejin Kim 9:20 AM (edited)\nOn it now');
  assert.deepEqual(lines(p), ['Jihoon Park|Can you check the PR?', 'Sejin Kim|On it now']);
});

test('blocks: Telegram Desktop "이름, [03.11.26 9:15]" with dotted day-month-year', () => {
  const p = read('박팀장, [03.11.26 09:15]\n배포 됐어요?\n\n김세진, [03.11.26 09:17]\n아직이요 곧 됩니다');
  assert.deepEqual(lines(p), ['박팀장|배포 됐어요?', '김세진|아직이요 곧 됩니다']);
  assert.equal(p.messages[0].date, '2026년 11월 3일');
});

test('blocks: Teams-style "[오전 9:15] 이름" header', () => {
  const p = read('[오전 9:15] 박팀장\n자료 공유 부탁드려요\n[오전 9:16] 김세진\n지금 올렸습니다');
  assert.deepEqual(lines(p), ['박팀장|자료 공유 부탁드려요', '김세진|지금 올렸습니다']);
});

test('blocks: name on one line, time on the next', () => {
  const p = read('박팀장\n오전 9:15\n오늘 회의 몇 시죠?\n김세진\n오전 9:16\n3시입니다\n박팀장\n오전 9:17\n넵');
  assert.deepEqual(lines(p), ['박팀장|오늘 회의 몇 시죠?', '김세진|3시입니다', '박팀장|넵']);
});

test('blocks: a time printed under a bubble is dropped, not read as a header', () => {
  const p = read('박팀장  오전 9:15\n확인 부탁드려요\n오전 9:15\n김세진  오전 9:16\n넵\n오전 9:16');
  assert.deepEqual(lines(p), ['박팀장|확인 부탁드려요', '김세진|넵']);
});

test('blocks: a short reply is not mistaken for a name', () => {
  // "넵" sits above a time once; one occurrence is not enough to be a name.
  const p = read('박팀장  오전 9:15\n오늘까지요\n넵\n오전 9:16\n김세진  오전 9:20\n완료했습니다');
  assert.deepEqual(lines(p), ['박팀장|오늘까지요', '박팀장|넵', '김세진|완료했습니다']);
});

test('date banners and 오늘/어제 set the date', () => {
  const p = read('어제\n박팀장: 수고하셨어요\n김세진: 감사합니다\n2026년 11월 6일 목요일\n박팀장: 좋은 아침입니다\n김세진: 안녕하세요');
  assert.equal(p.messages[0].date, '2026년 11월 5일');
  assert.equal(p.messages[2].date, '2026년 11월 6일');
});

test('undated paste leaves the date empty for the app to fill', () => {
  const p = read('박팀장: 오늘까지 되나요?\n김세진: 넵');
  assert.equal(p.messages[0].date, null);
});

test('system notices and media placeholders', () => {
  const p = read('박팀장: 사진\n김세진님이 들어왔습니다\n김세진: 확인했습니다');
  assert.equal(p.messages.length, 2);
  assert.equal(p.messages[0].media, true);
});

test('prose is not a chat', () => {
  const p = read('오늘 회의에서 정한 것들.\n참고: 다음 주까지 초안 완성.\n각자 맡은 부분을 정리해서 공유하기로 했다.\n일정은 다시 잡는다.');
  assert.equal(p.messages.length, 0);
  assert.equal(p.format, 'unknown');
});

test('bubbles with no names at all come back empty, for the model to read', () => {
  const p = read('오늘까지 되나요?\n넵 확인하고 말씀드릴게요\n부탁해요');
  assert.equal(p.messages.length, 0);
});

test('speakers counted, most talkative first', () => {
  const p = read('A: 1번\nB: 2번\nB: 3번');
  assert.deepEqual(p.speakers, [{ name: 'B', count: 2 }, { name: 'A', count: 1 }]);
});

test('koreanDate: slash dates are month/day/year', () => {
  assert.equal(koreanDate('11/3/2026'), '2026년 11월 3일');
  assert.equal(koreanDate('2026.11.03'), '2026년 11월 3일');
  assert.equal(koreanDate('11월 3일', TODAY), '2026년 11월 3일');
});

test('fromModelRows: my bubbles become 나, junk rows dropped', () => {
  const p = fromModelRows([
    { speaker: '박팀장', text: '오늘까지 되나요?', time: '오전 9:15', date: '2026-11-03' },
    { speaker: 'whoever', text: '넵', mine: true },
    { speaker: 'x' },
    null,
    { text: '   ' },
  ], { today: TODAY });
  assert.deepEqual(lines(p), ['박팀장|오늘까지 되나요?', '나|넵']);
  assert.equal(p.messages[0].date, '2026년 11월 3일');
  assert.equal(p.messages[0].minutes, 9 * 60 + 15);
  assert.equal(p.format, 'model');
});

test('fromModelRows: a row with no speaker is the other person', () => {
  const p = fromModelRows([{ text: '안녕하세요' }]);
  assert.equal(p.messages[0].speaker, '상대');
});

console.log(`\n${passed} passed`);
