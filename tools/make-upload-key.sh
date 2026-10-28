#!/usr/bin/env bash
# Make the Play upload key, and print the four GitHub secrets it needs.
#
# Run this on your own computer, not in CI and not in a shared session: the
# key and its password are printed once, here, and nowhere else. That is the
# point — the upload key is the one credential in this project that proves an
# update came from you.
#
#   bash tools/make-upload-key.sh
#
# Needs `keytool`, which comes with any Java (JDK). Install Temurin from
# https://adoptium.net on either system. On macOS its .pkg puts the JDK where
# /usr/bin/keytool finds it; Homebrew's openjdk is keg-only and does not, so
# `brew install openjdk` alone still leaves keytool missing. On Windows, run
# this from Git Bash, and tick "Add to PATH" in the installer.
set -euo pipefail

DIR="$HOME/k-office-english-upload-key"
KEYSTORE="$DIR/upload.jks"
ALIAS="upload"

if ! command -v keytool >/dev/null 2>&1; then
  echo "keytool 을 찾을 수 없습니다. Java(JDK)를 먼저 설치하세요."
  echo "  https://adoptium.net 에서 Temurin JDK 를 내려받아 설치하세요 (Mac 은 .pkg, Windows 는 .msi)."
  echo "  Windows 는 설치 중 \"Add to PATH\" 를 켜고, 설치 후 Git Bash 를 새로 열어 다시 실행하세요."
  echo "  Mac 에서 brew install openjdk 만으로는 keytool 이 잡히지 않습니다."
  exit 1
fi

# Outside the repository on purpose: a key that never sits in the working tree
# cannot be committed by accident, .gitignore or not.
mkdir -p "$DIR"
chmod 700 "$DIR"

if [ -e "$KEYSTORE" ]; then
  echo "이미 키가 있습니다: $KEYSTORE"
  echo "덮어쓰지 않습니다 — Play 에 한 번이라도 올린 뒤라면 그 키를 계속 써야 합니다."
  exit 1
fi

# 32 random letters and digits. Long enough that nobody guesses it, and no
# symbols that a shell or a secrets form could mangle on the way.
#
# pipefail is off for this one line: head stops reading after 32 characters,
# tr dies of SIGPIPE as it should, and with pipefail on that ordinary ending
# counts as a failure and set -e kills the script before the key exists.
PASSWORD=$(set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
if [ "${#PASSWORD}" -ne 32 ]; then
  echo "비밀번호를 만들지 못했습니다. 다시 실행해 주세요."
  exit 1
fi

keytool -genkeypair \
  -keystore "$KEYSTORE" -storetype JKS \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias "$ALIAS" \
  -storepass "$PASSWORD" -keypass "$PASSWORD" \
  -dname "CN=K-Office English, O=ksj11167, C=KR" \
  >/dev/null 2>&1

chmod 600 "$KEYSTORE"

# base64 on one line. Piping through tr is the form that behaves the same on
# macOS and Linux, whose base64 tools disagree about wrapping and flags.
B64=$(base64 < "$KEYSTORE" | tr -d '\n')

cat <<EOF

업로드 키를 만들었습니다: $KEYSTORE

────────────────────────────────────────────────────────────────────
 지금 당장: 아래 비밀번호와 위 파일을 비밀번호 관리자에 보관하세요.
 이 화면을 닫으면 비밀번호는 다시 볼 수 없습니다.
────────────────────────────────────────────────────────────────────

비밀번호:  $PASSWORD

GitHub → 저장소 → Settings → Secrets and variables → Actions
→ New repository secret 으로 아래 4개를 하나씩 넣으세요.

  이름: ANDROID_KEYSTORE_PASSWORD
  값:   $PASSWORD

  이름: ANDROID_KEY_PASSWORD
  값:   $PASSWORD

  이름: ANDROID_KEY_ALIAS
  값:   $ALIAS

  이름: ANDROID_KEYSTORE_BASE64
  값:   (아래 한 줄 전체 — 길이 ${#B64}자)

$B64

EOF
