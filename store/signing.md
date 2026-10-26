# 앱 서명

## 이게 왜 필요한가

Play는 **서명된 번들(AAB)** 하나만 받는다. 푸시마다 CI가 만드는 디버그 APK는 케이블로
설치해 보기엔 충분하지만 콘솔에 올리면 거부된다.

서명은 「이 업데이트를 낸 사람이 처음 올린 그 사람이 맞다」를 증명하는 장치다. 그래서
키를 잃어버리면 같은 앱으로 업데이트를 낼 수 없다 — 새 앱으로 다시 시작해야 하고,
설치해 둔 사람들은 따라오지 않는다.

**Play 앱 서명(Play App Signing)을 쓰면 그 위험이 작아진다.** 실제 배포 키는 Google이
보관하고, 당신이 관리하는 건 **업로드 키** 하나뿐이다. 업로드 키를 잃어도 Google에
재설정을 요청할 수 있다. 처음 올릴 때 기본으로 켜져 있으니 끄지 않으면 된다.

아래에서 만드는 건 그 **업로드 키**다.

---

## 1. 업로드 키 만들기 — 명령 한 줄

**본인 컴퓨터**의 터미널(macOS: 터미널, Windows: Git Bash)에서:

```bash
curl -fsSLO https://raw.githubusercontent.com/ksj11167/k-office-english/main/tools/make-upload-key.sh
bash make-upload-key.sh
```

저장소를 이미 받아 뒀다면 그 폴더에서 `bash tools/make-upload-key.sh` 한 줄이면 된다.

스크립트가 하는 일:

- 키를 저장소 **밖** `~/k-office-english-upload-key/upload.jks`에 만든다 (실수로 커밋될
  수 없게)
- 32자 비밀번호를 무작위로 만든다
- 2번에 넣을 **시크릿 4개의 이름과 값**을 화면에 그대로 찍어 준다
- 키가 이미 있으면 덮어쓰지 않고 멈춘다

**`keytool`이 없다고 나오면** Java(JDK)를 먼저 깐다. macOS는 `brew install openjdk`,
Windows는 https://adoptium.net 에서 Temurin JDK를 깔고 **Git Bash**에서 실행한다.

**화면에 나온 비밀번호와 `upload.jks` 파일을 비밀번호 관리자(또는 안전한 곳)에
보관한다.** 이 문서에서 가장 중요한 한 줄이다. 저장소에는 절대 넣지 않는다.

<details>
<summary>스크립트 없이 직접 만들려면</summary>

```bash
keytool -genkeypair -v \
  -keystore upload.jks \
  -storetype JKS \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload
```

- 비밀번호를 묻는다. 키 비밀번호를 따로 물으면 같은 걸 써도 된다
- `-validity 10000`은 약 27년이다. 짧게 잡으면 그 날짜 이후로 업데이트를 못 낸다

GitHub 시크릿에는 파일을 못 넣으니 base64 한 줄로 바꾼다:

| | 명령 |
|---|---|
| macOS | `base64 -i upload.jks \| pbcopy` |
| Linux | `base64 -w0 upload.jks` |
| Windows (PowerShell) | `[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload.jks")) \| Set-Clipboard` |

</details>

## 2. 저장소에 값 4개 넣기

**Settings → Secrets and variables → Actions → Secrets → New repository secret**

| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 스크립트가 맨 아래에 찍은 긴 한 줄 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `upload` (위 명령의 `-alias` 값) |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 (따로 안 정했으면 키스토어 비밀번호와 같다) |

한 번 넣으면 다시 볼 수 없다 — GitHub는 시크릿을 보여주지 않고 덮어쓰기만 된다.
그래서 비밀번호는 본인 쪽에도 남겨둬야 한다.

## 3. 번들 만들기

**Actions → Build release bundle → Run workflow**

`version_code`는 첫 업로드면 `1` 그대로 두면 된다.

끝나면 실행 화면 아래 **Artifacts**에 `k-office-english-release-aab`가 생긴다.
내려받아 압축을 풀면 `app-release.aab`가 나온다.

워크플로가 중간에 하는 일 두 가지를 알아두면 좋다:

- **번역 서버 주소를 심는다.** 저장소 변수 `PROXY_URL`이 비어 있으면 경고만 내고 그냥
  진행한다 — 그 번들로는 카톡 대화를 영어로 옮길 수 없다. 테스터에게 주기 전에 채운다
  (`server/README.md`)
- **어떤 키로 서명됐는지 확인한다.** 설정이 안 먹으면 gradle이 조용히 디버그 키로
  서명하는데, 그건 Play가 **업로드한 뒤에** 거부한다. 그래서 올리기 전에 여기서 막는다

### 키 없이 길만 확인해 보기

`throwaway_key`를 켜고 실행하면 버려지는 키를 그 자리에서 만들어 서명한다. 빌드가
끝까지 도는지 보는 용도이고, **나오는 AAB는 Play에 올리면 안 된다** — Play는 처음 본
키에 앱을 묶기 때문에 그걸 올리면 진짜 키를 영영 못 쓴다.

## 4. 올리기

Play Console → 테스트 → **비공개 테스트** 트랙. 내부 테스트가 아니다 — 새 개인
개발자 계정의 「테스터 12명 × 14일」 요건은 비공개 트랙에서만 인정된다.

콘솔에서 무엇을 어떻게 누르는지는 `store/play-console.md`에 순서대로 있다.

---

## 다음 업로드부터

**`version_code`를 더 큰 숫자로 넣고 실행한다.** Run workflow 창의 입력란이고,
커밋할 필요가 없다. 같은 숫자는 Play가 거부한다.

```
1 → 2 → 3 …   올리기만 하면 되고, 건너뛰어도 된다
```

사람이 읽는 `versionName`("1.0")은 `android/app/build.gradle`에 있고 아무 때나
바꿔도 된다. 둘은 별개다 — 스토어에 보이는 건 `versionName`, Play가 중복을
판단하는 건 `versionCode`다.

## 키를 잃어버렸다면

Play 앱 서명을 쓰고 있다면 끝이 아니다. Play Console에서 업로드 키 재설정을 요청하고,
새 키로 만든 번들을 다시 올리면 된다. 사용자 쪽에서는 아무 일도 일어나지 않는다.
