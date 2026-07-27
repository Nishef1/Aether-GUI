#!/usr/bin/env bash

set -euo pipefail

: "${ANDROID_MIN_API:?ANDROID_MIN_API is required}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
workspace=${GITHUB_WORKSPACE:-$(cd "$script_dir/../.." && pwd)}
tauri_dir="$workspace/src-tauri"
android_dir="$tauri_dir/gen/android"
gradlew="$android_dir/gradlew"
gradle_settings="$android_dir/tauri.settings.gradle"
gradle_dependencies="$android_dir/app/tauri.build.gradle.kts"
plugin_source="$workspace/src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"

[[ -f "$android_dir/settings.gradle" || -f "$android_dir/settings.gradle.kts" ]] || {
  echo "Generated Android Gradle project was not found at $android_dir" >&2
  exit 2
}

[[ -f "$gradlew" ]] || {
  echo "Gradle wrapper was not found at $gradlew" >&2
  exit 3
}

python3 "$script_dir/../tests/test_android_mobile_config.py"
python3 "$script_dir/../tests/test_android_rust_plugin_dependency.py"

# In the real repository, prove the deterministic runtime patcher is idempotent
# and verify transport/crash-safe teardown contracts. Do not gate the build on a
# second text-based imitation of Kotlin compilation: compileDebugKotlin below is
# the authoritative check for AndroidX, Tauri and Kotlin API/type compatibility.
if [[ -f "$plugin_source" ]]; then
  python3 "$script_dir/../tests/test_android_transport_patcher.py"
  python3 "$script_dir/apply-android-wireguard-policy.py"
  python3 "$script_dir/../tests/test_android_transport_contract.py"
  python3 "$script_dir/../tests/test_android_disconnect_contract.py"
fi

app_package=$(
  python3 - "$tauri_dir/tauri.conf.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    identifier = json.load(config_file)["identifier"]

parts = identifier.split(".")
if not parts or any(not part or not part.replace("_", "a").isalnum() or part[0].isdigit() for part in parts):
    raise SystemExit(f"Unsupported Android package identifier: {identifier!r}")

print(identifier)
PY
)

app_library=$(
  python3 - "$tauri_dir/Cargo.toml" <<'PY'
import sys
import tomllib

with open(sys.argv[1], "rb") as cargo_file:
    manifest = tomllib.load(cargo_file)

library = manifest.get("lib", {}).get("name")
if not library:
    library = manifest["package"]["name"].replace("-", "_")
print(library)
PY
)

kotlin_out_dir="$android_dir/app/src/main/java/${app_package//./\/}/generated"
mkdir -p "$kotlin_out_dir"

export TAURI_ANDROID_PROJECT_PATH="$android_dir"
export TAURI_ANDROID_PACKAGE_UNESCAPED="$app_package"
export WRY_ANDROID_PACKAGE="$app_package"
export WRY_ANDROID_LIBRARY="$app_library"
export WRY_ANDROID_KOTLIN_FILES_OUT_DIR="$kotlin_out_dir"

if [[ -n "${NDK_HOME:-}" ]]; then
  export ANDROID_NDK_HOME="$NDK_HOME"
  export ANDROID_NDK_ROOT="$NDK_HOME"
fi

(
  cd "$tauri_dir"
  cargo ndk \
    --target arm64-v8a \
    --platform "$ANDROID_MIN_API" \
    check \
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

[[ -d "$kotlin_out_dir" ]] || {
  echo "Tauri Kotlin output directory does not exist: $kotlin_out_dir" >&2
  exit 6
}

grep -Fq "include ':tauri-plugin-aether-vpn'" "$gradle_settings" || {
  echo "Generated Tauri settings do not include the aether-vpn plugin module" >&2
  cat "$gradle_settings" >&2
  exit 7
}

grep -Fq 'implementation(project(":tauri-plugin-aether-vpn"))' "$gradle_dependencies" || {
  echo "Generated app dependencies do not include the aether-vpn plugin module" >&2
  cat "$gradle_dependencies" >&2
  exit 8
}

chmod +x "$gradlew"

# Compile the actual plugin and run its pure-JVM lifecycle/transport tests before
# complete APK assembly. This is the single source of truth for Kotlin validity.
"$gradlew" \
  -p "$android_dir" \
  :tauri-plugin-aether-vpn:compileDebugKotlin \
  :tauri-plugin-aether-vpn:testDebugUnitTest \
  --no-daemon \
  --stacktrace \
  --warning-mode all
