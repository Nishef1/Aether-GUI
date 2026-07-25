#!/usr/bin/env bash

set -euo pipefail

: "${ANDROID_MIN_API:?ANDROID_MIN_API is required}"

workspace=${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
tauri_dir="$workspace/src-tauri"
android_dir="$tauri_dir/gen/android"
gradlew="$android_dir/gradlew"
gradle_settings="$android_dir/tauri.settings.gradle"
gradle_dependencies="$android_dir/app/tauri.build.gradle.kts"

[[ -f "$android_dir/settings.gradle" || -f "$android_dir/settings.gradle.kts" ]] || {
  echo "Generated Android Gradle project was not found at $android_dir" >&2
  exit 2
}

[[ -f "$gradlew" ]] || {
  echo "Gradle wrapper was not found at $gradlew" >&2
  exit 3
}

# `tauri android init` creates the static Gradle project, but the dynamic
# tauri.settings.gradle and app/tauri.build.gradle.kts files are emitted by the
# application's Rust build script. Gradle cannot even evaluate settings until
# these files exist, so bootstrap one Android Rust library build first.
export TAURI_ANDROID_PROJECT_PATH="$android_dir"
(
  cd "$tauri_dir"
  cargo ndk \
    --target arm64-v8a \
    --platform "$ANDROID_MIN_API" \
    build \
    --lib
)

[[ -s "$gradle_settings" ]] || {
  echo "Tauri did not generate $gradle_settings" >&2
  exit 4
}

[[ -s "$gradle_dependencies" ]] || {
  echo "Tauri did not generate $gradle_dependencies" >&2
  exit 5
}

grep -Fq "include ':tauri-plugin-aether-vpn'" "$gradle_settings" || {
  echo "Generated Tauri settings do not include the aether-vpn plugin module" >&2
  cat "$gradle_settings" >&2
  exit 6
}

grep -Fq 'implementation(project(":tauri-plugin-aether-vpn"))' "$gradle_dependencies" || {
  echo "Generated app dependencies do not include the aether-vpn plugin module" >&2
  cat "$gradle_dependencies" >&2
  exit 7
}

chmod +x "$gradlew"

# Compile only the custom plugin first. This catches missing AndroidX/Tauri APIs
# before the complete APK assembly and produces a focused Kotlin stack trace.
"$gradlew" \
  -p "$android_dir" \
  :tauri-plugin-aether-vpn:compileDebugKotlin \
  --no-daemon \
  --stacktrace \
  --warning-mode all
