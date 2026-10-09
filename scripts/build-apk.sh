#!/usr/bin/env bash
# Builds an installable Android APK (debug-signed, no extra setup).
#
# Requirements: JDK 17+, Android SDK (ANDROID_HOME), and a project build.
# The web bundle is copied into the app assets, so run `npm run build` first
# or let this script do it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building web bundle"
npm run build

echo "==> Bundling web assets into the Android app"
rm -rf android/app/src/main/assets
mkdir -p android/app/src/main/assets
cp -r dist/. android/app/src/main/assets/

echo "==> Assembling release APK"
cd android
./gradlew assembleRelease --no-daemon

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
# Served by the audio proxy at /MONOCHROME.apk. Kept out of public/ so Vite
# does not bundle the APK into the web build (which the app itself embeds).
mkdir -p "$ROOT/downloads"
cp "$APK" "$ROOT/downloads/MONOCHROME.apk"
echo "==> Done: $APK"
ls -lh "$APK"
