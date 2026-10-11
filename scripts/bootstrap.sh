#!/usr/bin/env bash
# Restores the tools this project needs, which a container restart wipes:
# yt-dlp (full-length audio proxy), a JDK and the Android SDK (APK build).
# Safe to re-run; each step is skipped when the tool is already present.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JDK_DIR="${JDK_DIR:-/home/openhands/jdk}"
SDK_DIR="${SDK_DIR:-/home/openhands/android-sdk}"

have() { command -v "$1" >/dev/null 2>&1; }

if python3 -c "import yt_dlp" >/dev/null 2>&1; then
  echo "==> yt-dlp present"
else
  echo "==> Installing yt-dlp"
  pip install -q --user yt-dlp
fi

if [ -x "$JDK_DIR/bin/java" ]; then
  echo "==> JDK present ($JDK_DIR)"
else
  echo "==> Installing Temurin JDK 21 into $JDK_DIR"
  mkdir -p "$JDK_DIR"
  curl -sL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" \
    | tar xz -C "$JDK_DIR" --strip-components=1
fi

if [ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "==> Android SDK present ($SDK_DIR)"
else
  echo "==> Installing Android command-line tools into $SDK_DIR"
  mkdir -p "$SDK_DIR/cmdline-tools"
  tmp="$(mktemp -d)"
  curl -sL -o "$tmp/cmdline.zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$tmp/cmdline.zip" "$SDK_DIR/cmdline-tools"
  mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  rm -rf "$tmp"
fi

export JAVA_HOME="$JDK_DIR"
export ANDROID_HOME="$SDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"

chmod +x "$SDK_DIR"/cmdline-tools/latest/bin/* 2>/dev/null || true
if [ ! -d "$SDK_DIR/platforms/android-35" ]; then
  echo "==> Installing Android SDK packages"
  yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
  "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" \
    "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null
fi

cat <<EOF

==> Toolchain ready. Use it like this:
    export JAVA_HOME=$JDK_DIR
    export ANDROID_HOME=$SDK_DIR
    export PATH=\$JAVA_HOME/bin:\$PATH
    npm run dev        # site + full-length audio proxy on :12000
    npm run build:apk  # installable APK -> downloads/MONOCHROME.apk
EOF
