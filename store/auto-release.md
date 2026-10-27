# 자동 배포

한 번 설정하면 이후 업데이트는 **버튼 한 번**(또는 태그 하나)으로 빌드 → 서명 →
Play 업로드까지 사람 손 없이 간다.

```
Actions → Build release bundle → Run workflow      (올릴 곳: alpha = 비공개 테스트)
또는
git tag v1.0.1 && git push origin v1.0.1            (비공개 테스트로, versionName 1.0.1)
```

- **versionCode는 자동**이다. 워크플로 실행 번호를 쓰므로 실행할 때마다 커지고, 지난번
  숫자를 기억할 필요가 없다
- **versionName**(스토어에 보이는 버전)은 태그에서 온다: `v1.2.0` → `1.2.0`. 버튼으로
  돌리면 `1.0`

## 자동으로 안 되는 것 — Google이 막아 둔 두 가지

1. **첫 업로드는 손으로.** Play의 API는 한 번도 출시된 적 없는 앱에는 올리지 못한다.
   첫 AAB만 Play Console에서 직접 올린다 (`store/play-console.md` 4번). 워크플로는
   서비스 계정이 없으면 업로드를 건너뛰고 AAB를 Artifacts에 남기니, 그걸 올리면 된다
2. **심사와 14일 테스트.** 자동 업로드는 「올리기」까지다. 심사 통과, 테스터 12명 × 14일,
   프로덕션 액세스 승인은 Google 쪽 절차라 기다려야 한다

## 설정 — 서비스 계정 한 번 만들기 (15분)

GitHub가 내 대신 Play에 올리려면 Play가 믿는 **서비스 계정**이 필요하다.

### 1. Google Cloud에서 서비스 계정과 키 만들기

1. https://console.cloud.google.com → 위쪽 프로젝트 선택 → **새 프로젝트**
   (이름 아무거나, 예: `k-office-english`)
2. 검색창에 **Google Play Android Developer API** → **사용** 누르기
3. **IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기**
   - 이름: `github-release` → 만들고 계속 → 역할은 **비워 두고** 완료
4. 만든 계정을 눌러 **키 → 키 추가 → 새 키 만들기 → JSON** → 파일이 내려받아진다
5. 서비스 계정의 **이메일 주소**(`github-release@….iam.gserviceaccount.com`)를 복사해 둔다

### 2. Play Console에서 그 계정에 권한 주기

1. Play Console → **사용자 및 권한 → 새 사용자 초대**
2. 이메일: 위에서 복사한 서비스 계정 주소
3. **앱 권한 → 앱 추가 → K-직장인 영어** 선택 후 아래 권한 체크:
   - 앱 정보 보기 (읽기 전용)
   - **테스트 트랙에 앱 출시**
   - **프로덕션에 앱 출시, 기기 제외, Play App Signing 사용** (프로덕션 자동 출시를 쓸 때만)
4. **사용자 초대** → 확인

### 3. GitHub에 키 넣기

**Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON` | 1-4에서 받은 JSON 파일을 메모장으로 열어 **전체 내용** 붙여넣기 |

JSON 파일은 업로드 키만큼 중요하다 — 넣은 뒤 컴퓨터에서 지우거나 안전한 곳에 둔다.

## 쓰는 법

| 하고 싶은 것 | 방법 |
|---|---|
| 테스터에게 새 버전 | Run workflow, 올릴 곳 `alpha` (기본값) |
| 정식 출시 사용자에게 | Run workflow, 올릴 곳 `production` — 프로덕션 액세스 승인 뒤에만 |
| 빌드만, 업로드는 손으로 | Run workflow, 올릴 곳 `none` |
| 태그로 출시 | `git tag v1.0.1 && git push origin v1.0.1` → `alpha`로 |

실행 화면 마지막 단계 「What happened」에 어디에 올렸는지 적힌다.

## 문제가 생기면

| 메시지 | 원인 |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON 이 없어 자동 업로드를 건너뜁니다` | 정상 — 아직 설정 전이다. AAB를 직접 올린다 |
| `The caller does not have permission` | 2번 초대가 안 됐거나 권한이 빠졌다. 초대 후 반영까지 몇 분~하루 걸릴 수 있다 |
| `Package not found` | 첫 업로드를 아직 손으로 안 했다 (위 「자동으로 안 되는 것」 1번) |
| `Only releases with status draft may be created on draft app` | 첫 출시가 아직 검토 전이다. 첫 비공개 테스트 출시가 승인된 뒤 다시 실행 |
| `APK specifies a version code that has already been used` | 손으로 더 큰 번호를 올린 적이 있다. Run workflow의 `version_code`에 그보다 큰 수를 한 번 넣는다 |
