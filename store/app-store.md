# App Store 출시 답안지

Apple 쪽에서 해야 하는 일을 **하는 순서대로** 적었다. Mac은 필요 없다 — 빌드·서명·업로드는
`.github/workflows/ios-release.yml`이 GitHub의 Mac에서 한다. 사람 손이 가는 건 계정과
App Store Connect 화면뿐이다.

```
0 멤버십 확인 → 1 번들 ID 등록 → 2 App Store Connect에 앱 만들기 → 3 API 키
→ 4 GitHub 시크릿 4개 → 5 빌드·TestFlight (자동) → 6 내 아이폰에서 확인 → 7 심사 제출
```

> 번역 서버(`server/README.md`)가 **심사 제출 전에** 붙어 있어야 한다. 서버 없이 내면
> 앱의 핵심 기능에 «API 키 필요»가 붙은 채로 심사를 받게 되고, 미완성 앱으로 반려되기 쉽다.
> TestFlight까지는 서버 없이도 된다.

---

## 0. 멤버십 확인

[developer.apple.com/account](https://developer.apple.com/account) → **Membership details**.
**Apple Developer Program**이 **Active**면 된다. 아니면 같은 화면의 **Enroll**
(개인, 연 129,000원). 승인에 보통 하루이틀.

같은 화면의 **Team ID**(영문·숫자 10자)를 적어 둔다 — 4번에 쓴다.

## 1. 번들 ID 등록

[Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list) → **+**

- **App IDs** → **App** → Continue
- Description: `K-Office English`
- Bundle ID: **Explicit**, `com.ksj11167.kofficeenglish`
  (안드로이드와 같은 값. 한 번 정하면 못 바꾼다)
- Capabilities: 아무것도 켜지 않는다 → Continue → Register

인증서와 프로비저닝 프로파일은 **만들지 않는다.** 빌드가 API 키로 알아서 만든다.

## 2. App Store Connect에 앱 만들기

[App Store Connect → 앱](https://appstoreconnect.apple.com/apps) → **+ → 신규 앱**

| 칸 | 값 |
|---|---|
| 플랫폼 | iOS |
| 이름 | `K-직장인 영어` — 이미 쓰인 이름이면 `K-직장인 영어: 업무 영어 말하기` |
| 기본 언어 | 한국어 |
| 번들 ID | `com.ksj11167.kofficeenglish` (1번에서 등록한 것이 목록에 뜬다) |
| SKU | `kofficeenglish` |
| 사용자 액세스 | 전체 액세스 |

## 3. App Store Connect API 키

[사용자 및 액세스 → 통합 → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)

1. 처음이면 **액세스 요청**부터 (바로 승인된다)
2. **팀 키** 탭 → **+** → 이름 `github-actions`, 액세스 **관리(Admin)**
   - 관리 권한이어야 빌드가 배포 인증서를 직접 만들 수 있다. 개발자(Developer) 권한이면
     서명 단계에서 멈춘다
3. 만들어진 줄의 **API 키 다운로드** → `AuthKey_XXXXXXXXXX.p8`
   - **한 번만 받을 수 있다.** 비밀번호 관리자에 보관
4. 같은 화면의 **Issuer ID**(UUID)와 그 키의 **키 ID**를 적어 둔다

## 4. GitHub 시크릿 4개

[저장소 → Settings → Secrets and variables → Actions → New repository secret](https://github.com/ksj11167/k-office-english/settings/secrets/actions)

| 이름 | 값 |
|---|---|
| `ASC_KEY_ID` | 3-4번 키 ID (10자) |
| `ASC_ISSUER_ID` | 3-4번 Issuer ID |
| `ASC_KEY_P8` | `.p8` 파일을 메모장/텍스트 편집기로 열어 `-----BEGIN PRIVATE KEY-----`부터 마지막 줄까지 **전부** |
| `APPLE_TEAM_ID` | 0번 Team ID |

빈 칸이나 형식이 틀린 값은 빌드가 첫 단계에서 무엇이 틀렸는지 말하고 멈춘다.

## 5. 빌드 · TestFlight 업로드 — 자동

**Actions → Build iOS release → Run workflow** (dry_run은 끈 채로). 또는 `v1.0.0` 같은
태그를 올리면 돈다.

GitHub의 Mac이 Release로 빌드하고, API 키로 서명해서 App Store Connect에 올린다.
Apple 쪽 처리(수분~수십 분)가 끝나면 **TestFlight** 탭에 빌드가 뜬다. 빌드 번호는 실행
번호 + 100이라 매번 커진다.

## 6. 내 아이폰에서 확인

App Store Connect → 앱 → **TestFlight → 내부 테스트 → +** 그룹 만들기 → 본인 추가.
아이폰에 **TestFlight** 앱을 깔면 초대가 뜬다. 내부 테스트는 **심사 없이 바로** 된다.

## 7. 심사 제출

### 앱 정보

| 칸 | 값 |
|---|---|
| 부제 | `내 메신저 대화로 하는 영어 말하기` (30자) |
| 카테고리 | 기본 **교육**, 보조 **비즈니스** |
| 개인정보 처리방침 URL | `https://ksj11167.github.io/k-office-english/privacy.html` |
| 연령 등급 | 모든 질문 «없음» → 4+ |
| 저작권 | `2026 ksj11167` |

설명·키워드·프로모션 텍스트는 `store/listing.md`의 App Store 칸.

### 앱 개인정보 (영양 성분표)

**데이터를 수집합니까 → 예.** Apple의 «수집»은 기기를 떠나 운영자나 제3자가 요청 처리
시간보다 오래 가질 수 있는 것이다. 운영자 서버는 저장하지 않지만, 번역을 맡는 Anthropic이
API 입력을 일정 기간 보관할 수 있으므로 «예»가 정직한 답이다. `ios/App/App/PrivacyInfo.xcprivacy`도
같은 두 항목을 적어 두었다 — 둘이 어긋나면 업로드 때 경고가 온다.

| 데이터 유형 | 용도 | 사용자와 연결 | 추적 |
|---|---|---|---|
| 사용자 콘텐츠 › **기타 사용자 콘텐츠** (대화 글과 이름) | 앱 기능 | 아니요 | 아니요 |
| 사용자 콘텐츠 › **사진 또는 비디오** (직접 고른 대화 캡처) | 앱 기능 | 아니요 | 아니요 |

나머지 유형(연락처, 위치, 식별자, 사용 데이터, 진단 등)은 전부 수집 안 함.

### 수출 규정

묻지 않는다 — `Info.plist`에 `ITSAppUsesNonExemptEncryption = NO`를 넣어 두었다
(HTTPS 외 암호화 없음).

### 심사 메모 (App Review Information → Notes)

로그인이 없으니 데모 계정 칸은 비운다. 아래를 그대로 붙인다.

```
No account or login is needed.

To see the full loop without importing anything:
1. Tap 「샘플로 먼저 보기」 (Try the sample) on the first screen.
2. Tap 「날짜별로 나누기」, open a day, pick 김세진 as "me", then 「내 말 … 연습하기」.
3. Each card shows a Korean line I said; tap the mic (「보고」) and say it in English,
   or swipe right (결재, I could say it) / left (반려, I could not).
「직무별 표현으로 연습하기」 on the first screen also works with no import.

To test importing your own chat: Settings is not needed. Tap 「내 대화 가져오기」 and paste:
박팀장: 오늘까지 되나요?
김세진: 넵 확인하고 말씀드릴게요
The first time anything is sent for translation, the app asks for permission to
send the conversation to Anthropic's Claude, and sends nothing if declined.
Screenshots can be picked from the same screen; they are read by the same model
after the same consent.

The microphone is used only for scoring the spoken English, on device.
```

### 스크린샷

6.9인치(1320×2868) 세트가 있으면 나머지 크기는 Apple이 줄여 쓴다. `node tools/screenshots.mjs`
가 실행 중인 앱에서 찍는다 — iPhone 6.9인치 크기를 추가해서 찍어 올린다.

## 다음 버전부터

코드를 고치고 **Build iOS release**를 다시 돌리면 TestFlight까지 자동이다. 심사 제출은
App Store Connect에서 **+ 버전** → 빌드 고르기 → 제출. 버전 이름을 바꾸려면 `v1.1.0` 태그.
