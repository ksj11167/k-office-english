# K-직장인 영어

“확인하고 말씀드릴게요”, “조금 늦어질 것 같아요” — 교재엔 안 나오는데 회사에서
매일 쓰는 말. 그걸 영어로 말하는 연습을 하루 5분씩 하는 앱이다.
아는 문장은 **오른쪽으로**, 막힌 문장은 **왼쪽으로** 넘긴다.

앱이 하는 일은 두 가지다:

1. **카톡 대화를 통째로 영어로** — 어제 단톡방이 영어 대화록이 된다
2. **그 중 내가 한 말을 카드로** — 내 차례만 비어 있는 영어 대화에서, 그 말을 직접 말해본다

> 직무별 표현집(200장)은 v1 범위 밖이다 — 코드와 카드는 `app/js/job-decks.js`에
> 남아 있고, 화면 복귀는 추후 마일스톤이다 (`docs/decisions.md` D20).

## 어떻게 동작하나

```
카톡 대화 내보내기(.txt)
        ↓  기기 안에서 파싱
   미리보기 + 승인 게이트
        ↓  날짜별로 분할
  9월 11일 · 7장   9월 13일 · 3장   …
        ↓  하루치만 번역 (앞뒤 맥락 포함)
  스와이프 덱 → 마이크 → 채점 → FSRS 간격반복
```

**하루가 학습 단위**다. 6개월치를 한 번에 처리하면 카드가 3,000장이 되어 아무도
끝내지 못하지만, 하루로 끊으면 5~30장이라 한 번에 끝난다. 그러면서도 하루 안에서는
`넵` 하나까지 전부 남는다 — 걸러내는 게 아니라 범위를 좁히는 것이라 "내가 한 말
그대로"라는 원칙을 깨지 않는다.

## 벤치마킹

| 출처 | 가져온 것 |
|---|---|
| 데이팅 앱 | 스와이프 채점 — 오른쪽 "외웠다", 왼쪽 "다시". 손가락 한 번이 버튼 찾기보다 빠르고, 드래그 중에 판정이 미리 보인다 |
| 듀오링고 | 두툼한 눌리는 버튼(아래 그림자), 굵은 진행 바, 큰 터치 타깃 |
| 스픽 | 말하기 중심 — 큰 마이크, 한 화면에 한 문장 |
| Anki | FSRS 스케줄러 (직접 구현하지 않고 `ts-fsrs` 사용) |

## 쓰는 오픈소스

| | 용도 | 라이선스 |
|---|---|---|
| [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 | 간격반복 스케줄링. `app/vendor/`에 벤더링 | MIT |
| [Capacitor](https://capacitorjs.com) 8.5.2 | 웹 앱을 iOS/Android 네이티브로 감싸기 | MIT |
| [`@capgo/capacitor-share-target`](https://github.com/Cap-go/capacitor-share-target) 8.0.52 | 공유시트로 카톡 내보내기 파일 받기 | MIT |
| [`@capgo/capacitor-speech-recognition`](https://github.com/Cap-go/capacitor-speech-recognition) 8.3.0 | 온디바이스 음성 인식 | MIT |
| IBM Plex Sans KR / Mono, Newsreader | 타이포그래피 (Google Fonts) | OFL |

스와이프 제스처와 서비스워커는 직접 썼다. 각각 100줄 남짓이라 의존성을 더할
이유가 없었다.

## 구성

```
app/                        배포 대상 (빌드 불필요, 정적 파일)
  privacy.html              개인정보 처리방침 (스토어 필수)
  index.html                화면 구조
  styles.css                토큰 · 스와이프 덱 · 라이트/다크
  manifest.webmanifest      설치형 PWA
  sw.js                     오프라인 셸
  js/
    main.js                 화면 전환과 세션 흐름
    kakao-parser.js         카톡 포맷 파싱 + 날짜 분할
    swipe.js                카드 스택 스와이프 (포인터 · 키보드)
    srs.js                  FSRS 래퍼
    translate.js            번역 제공자 (번역 서버 | 본인 API 키 | Claude 아티팩트)
    platform.js             네이티브/웹 한 겹 (공유시트 · 음성 인식 · 읽어주기)
    job-decks.js            직무별 표현집 — v1 범위 밖, 마일스톤 대기 (D20)
  vendor/ts-fsrs.mjs
android/  ios/              Capacitor 네이티브 셸 (cap sync가 app/을 복사)
capacitor.config.json
server/                     번역 프록시 (Cloudflare Worker) — 유일한 백엔드
site/                       소개 페이지 (앱 번들에는 안 들어간다)
test/e2e.test.mjs           브라우저로 전 흐름 훑기
test/proxy-integration...   앱 ↔ 번역 서버 이음매
tools/make-artifact.mjs     app/index.html → Claude 아티팩트용 파일
tools/screenshots.mjs       실제 앱에서 스토어 스크린샷 뽑기
store/                      스토어 등재 문구와 스크린샷
docs/prd.md                 v1 범위 · 타겟 · 성공 지표 · 비범위
docs/decisions.md           확정된 결정 · 가정 · 인터뷰 기록
```

## 테스트

```bash
npm test            # 파서 26 · 덱 데이터 9 · 번역 프록시 12
npm run test:e2e    # 브라우저로 전 흐름 20단계
npm run test:proxy  # 앱 ↔ 번역 서버 통합 8단계
npm run test:all    # 전부 (75개)
```

셋 다 **밀폐돼 있다.** 외부 요청을 전부 가로채므로 폰트 CDN이 느리다고 실패하지 않고,
`test:proxy`는 워커를 로컬에 띄운 뒤 Anthropic만 가짜로 세운다 — **API 키도 돈도 들지
않는다.** 충전된 키가 필요한 테스트는 아무도 돌리지 않는다.

`test:proxy`가 있는 이유: 워커 테스트는 브라우저 없이 `worker.fetch()`를 직접 부르고,
브라우저 테스트는 번역이 필요 없는 샘플로 돈다. 그래서 **일반 사용자가 지나는 경로**인
`viaProxy`를 양쪽 다 건드리지 않았다. 그 이음매를 보는 게 이 테스트다.

파서는 앱의 심장이고 카톡 포맷은 안정적인 계약이 아니다(Android 대괄호 형식과 iOS
날짜-쉼표 형식이 다르고, 여러 줄 메시지·미디어 자리표시자·시스템 공지가 섞인다).
테스트가 회귀 방어선이다.

## 실행

```bash
npx http-server app -p 8787
```

## 배포

세 곳에 나가고, 전부 같은 `app/` 소스를 쓴다.

**GitHub Pages** — `main`에 `app/**` 또는 `site/**`가 바뀌면 자동 배포된다
(`.github/workflows/pages.yml`). 배포본은 `app/`(앱)과 `site/`(소개 페이지)를
합쳐서 만든다 — `app/`은 Capacitor가 APK에 통째로 복사하는 폴더라, 앱에서 열 일
없는 것은 거기 두지 않는다.

- 앱 — https://ksj11167.github.io/k-office-english/
- 소개 페이지 — `.../intro.html` · 처리방침 — `.../privacy.html`

번역은 저장소 변수 `PROXY_URL`이 채워져 있으면 그 서버를 쓰고, 비어 있으면
설정 화면의 본인 API 키로 내려간다. 배포 시점에 끼워 넣으므로 코드 수정이 아니다.

**Claude 아티팩트** — `claude.use("sample")`로 뷰어의 Claude에 직접 번역을
요청하므로 키가 필요 없다. 아티팩트 플랫폼이 자체 `<head>`를 씌우기 때문에
문서 껍데기를 벗겨서 올린다:

```bash
node tools/make-artifact.mjs /tmp/artifact.html
```

**App Store / Play Store** — Capacitor 셸. `app/`을 그대로 WebView에 담고
네이티브 기능만 플러그인으로 연다. 번들러는 쓰지 않는다: 플러그인은
`window.Capacitor.Plugins`로 런타임에 잡고, 없으면 웹 경로로 내려간다
(`app/js/platform.js`).

```bash
npx cap sync            # app/ → android/, ios/
npx cap run android     # Android SDK 필요
```

네이티브가 푸는 것:

| | 웹에서 | 네이티브에서 |
|---|---|---|
| 카톡 공유시트 수신 | iOS 불가 | 양쪽 가능 |
| 음성 인식 | Chrome은 구글 서버로 전송 | **기기 안에서 처리** (iOS 26+ SpeechTranscriber / Android on-device) |

**iOS 빌드에 Mac을 소유할 필요는 없다.** 이 저장소가 공개라 macOS 러너가 무료·무제한이고,
`.github/workflows/ios.yml`이 시뮬레이터 빌드를 돌린다(수동 실행). App Store Connect
API 키를 넣으면 CI에서 서명과 TestFlight 업로드까지 간다 — 실제 장벽은 하드웨어가
아니라 Apple $99/년과 서명 설정이다 (D21). Android는 `.github/workflows/android.yml`이
푸시마다 디버그 APK를 만든다.

⚠️ 다만 **시뮬레이터 빌드는 서명이 없어 설치 파일이 아니다.** 껍데기가 컴파일된다는
것만 증명한다.

⚠️ **iOS 공유 확장(Share Extension)은 Xcode에서 타겟을 하나 추가해야 한다.**
플러그인이 네이티브 코드는 제공하지만 타겟 생성 자체는 Xcode 작업이라 이 환경에서
만들지 못했다. Android 쪽 인텐트 필터는 매니페스트에 넣어뒀다.

## 공유 — 왜 대화가 아니라 카드인가

“다른 사람이 만든 덱을 쓰고 싶다”가 사람들이 원하는 기능이다. 그런데 **카톡 대화를
공유하는 건 동의한 적 없는 동료의 발화를 제3자에게 넘기는 일**이다. 회사 단톡방이면
더 심각하다.

그래서 공유 단위를 대화가 아니라 **카드**로 잡았다:

| 공유되는 것 | 절대 공유하지 않는 것 |
|---|---|
| 한국어 문장 ↔ 영어 문장 | 원문 대화 로그 |
| 상황 태그, 직무 | 이름 · 날짜 · 대화방 |

그 1단계로 직무별 표현집 200장을 썼지만 **v1 화면에서는 내렸다** (D20). 코드와
카드는 `app/js/job-decks.js`에 남아 있고 데이터 테스트도 계속 돈다. 사용자 기여
(2단계)가 붙더라도 데이터 모양은 같다: 문장 쌍과 태그일 뿐, 대화 로그는 아니다.

## 알려진 제약

- **iOS 웹앱은 카톡 공유시트로 파일을 못 받는다** (Web Share Target 미지원).
  파일 앱에 저장한 뒤 앱에서 고르는 한 단계가 더 필요하다. Android는 직접 된다.
- **카드는 브라우저별로 저장된다** (localStorage). 기기 간 동기화 없음.
- **웹에서의 음성 인식은 브라우저 의존**이다. 미지원 시 정답 보기로 자동
  전환된다. Chrome은 오디오를 구글 서버로 보낸다 — 네이티브 셸에서는 온디바이스로
  처리되어 이 문제가 없다.
- **API 키를 브라우저에 두는 방식**은 공용 기기에서 쓰면 안 된다. Anthropic이
  `anthropic-dangerous-direct-browser-access` 헤더로 허용하는 "본인 키" 패턴이다.
- 카카오는 대화를 읽는 공식 API를 제공하지 않는다. 내보내기 파일이 유일한 경로다.
