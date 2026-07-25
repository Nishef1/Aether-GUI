#!/usr/bin/env bash

set -euo pipefail

workspace=${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
android_dir="$workspace/src-tauri/gen/android"
gradlew="$android_dir/gradlew"

[[ -f "$android_dir/settings.gradle" || -f "$android_dir/settings.gradle.kts" ]] || {
  echo "Generated Android Gradle project was not found at $android_dir" >&2
  exit 2
}

[[ -f "$gradlew" ]] || {
  echo "Gradle wrapper was not found at $gradlew" >&2
  exit 3
}

chmod +x "$gradlew"

# Compile only the custom plugin first. This catches missing AndroidX/Tauri APIs
# in under a minute and prevents waiting for the complete APK assembly to fail.
"$gradlew" \
  -p "$android_dir" \
  :tauri-plugin-aether-vpn:compileDebugKotlin \
  --no-daemon \
  --stacktrace \
  --warning-mode all
