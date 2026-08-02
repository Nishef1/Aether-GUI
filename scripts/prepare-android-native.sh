#!/usr/bin/env bash
set -euo pipefail

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print tolower($1)}'
  else
    shasum -a 256 "$1" | awk '{print tolower($1)}'
  fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AETHER_VERSION="v1.5.0"
AETHER_COMMIT="66a798b7771d5ffbb28fc858bffc99fb67295baf"
HEV_VERSION="2.14.4"
ANDROID_API="${ANDROID_MIN_API:-29}"
NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-${NDK_HOME:-}}}"
[[ -n "$NDK" && -x "$NDK/ndk-build" ]] || {
  echo "Android NDK was not found. Set ANDROID_NDK_HOME (or NDK_HOME)." >&2
  exit 2
}

PLUGIN_ANDROID="$ROOT/src-tauri/plugins/aether-vpn/android"
OUT="$PLUGIN_ANDROID/src/main/jniLibs/arm64-v8a"
LICENSES="$PLUGIN_ANDROID/src/main/assets/licenses"
STAMP="$PLUGIN_ANDROID/.native-versions.json"
EXPECTED_STAMP="{\"aether\":\"$AETHER_VERSION\",\"aether_commit\":\"$AETHER_COMMIT\",\"hev\":\"$HEV_VERSION\",\"api\":$ANDROID_API}"
if [[ -f "$OUT/libaether_exec.so" && -f "$OUT/libhev-socks5-tunnel.so" && -f "$OUT/libaethertun.so" && -f "$STAMP" && "$(tr -d '\r\n ' < "$STAMP")" == "$EXPECTED_STAMP" ]]; then
  echo "[android-native] pinned ARM64 bundle already prepared"
  exit 0
fi

for tool in curl git node tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 2; }
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aether-android-native.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
rm -rf "$OUT"
mkdir -p "$OUT" "$LICENSES"

HEADERS=(-H 'Accept: application/vnd.github+json' -H 'User-Agent: Aether-GUI-Android-Builder')
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  HEADERS+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

RELEASE_JSON="$(curl -fsSL --retry 5 --retry-all-errors "${HEADERS[@]}" \
  "https://api.github.com/repos/CluvexStudio/Aether/releases/tags/$AETHER_VERSION")"
AETHER_META="$(printf '%s' "$RELEASE_JSON" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);const a=(r.assets||[]).find(x=>x.name==="aether-android-arm64.tar.gz");if(!a?.browser_download_url||!String(a.digest||"").startsWith("sha256:"))process.exit(2);process.stdout.write(`${a.browser_download_url}\t${a.digest.slice(7)}`);});
')" || { echo "Official Aether ARM64 release asset/digest was not found" >&2; exit 3; }
IFS=$'\t' read -r AETHER_URL AETHER_SHA <<< "$AETHER_META"
AETHER_ARCHIVE="$TMP/aether.tar.gz"
curl -fsSL --retry 5 --retry-all-errors "${HEADERS[@]}" -o "$AETHER_ARCHIVE" "$AETHER_URL"
ACTUAL_AETHER_SHA="$(sha256_file "$AETHER_ARCHIVE")"
EXPECTED_AETHER_SHA="$(printf '%s' "$AETHER_SHA" | tr '[:upper:]' '[:lower:]')"
[[ "$ACTUAL_AETHER_SHA" == "$EXPECTED_AETHER_SHA" ]] || {
  echo "Aether Android release checksum mismatch" >&2
  exit 3
}
mkdir -p "$TMP/aether"
tar -xzf "$AETHER_ARCHIVE" -C "$TMP/aether"
AETHER_BIN="$(find "$TMP/aether" -type f -name aether -print -quit)"
[[ -n "$AETHER_BIN" ]] || { echo "Aether executable missing from release archive" >&2; exit 3; }
install -m 0755 "$AETHER_BIN" "$OUT/libaether_exec.so"
curl -fsSL --retry 3 -o "$LICENSES/Aether-AGPL-3.0.txt" \
  "https://raw.githubusercontent.com/CluvexStudio/Aether/$AETHER_COMMIT/LICENSE"

HEV_SRC="$TMP/hev"
git clone --quiet --depth 1 --branch "$HEV_VERSION" --recurse-submodules \
  https://github.com/heiher/hev-socks5-tunnel.git "$HEV_SRC"
[[ "$(git -C "$HEV_SRC" describe --tags --exact-match)" == "$HEV_VERSION" ]] || {
  echo "HEV tag verification failed" >&2
  exit 4
}
while IFS= read -r -d '' makefile; do
  sed -i.bak 's|[^[:space:]]*hev-jni\.c||g' "$makefile"
  rm -f "$makefile.bak"
done < <(find "$HEV_SRC" -name '*.mk' -print0)
find "$HEV_SRC" -name 'hev-jni.c' -delete
cat > "$HEV_SRC/Application.mk" <<EOF
APP_OPTIM := release
APP_PLATFORM := android-$ANDROID_API
APP_ABI := arm64-v8a
APP_CFLAGS := -O3
APP_STL := c++_static
APP_SUPPORT_FLEXIBLE_PAGE_SIZES := true
NDK_TOOLCHAIN_VERSION := clang
EOF
"$NDK/ndk-build" -C "$HEV_SRC" NDK_PROJECT_PATH=. \
  APP_BUILD_SCRIPT=Android.mk NDK_APPLICATION_MK=Application.mk
HEV_LIB="$HEV_SRC/libs/arm64-v8a/libhev-socks5-tunnel.so"
[[ -f "$HEV_LIB" ]] || { echo "HEV ARM64 library was not produced" >&2; exit 4; }
install -m 0644 "$HEV_LIB" "$OUT/libhev-socks5-tunnel.so"
HEV_LICENSE="$(find "$HEV_SRC" -maxdepth 2 -type f \( -iname LICENSE -o -iname LICENSE.txt \) -print -quit)"
[[ -n "$HEV_LICENSE" ]] || { echo "HEV license missing" >&2; exit 4; }
install -m 0644 "$HEV_LICENSE" "$LICENSES/HEV-LICENSE.txt"

TOOLCHAIN="$(find "$NDK/toolchains/llvm/prebuilt" -mindepth 1 -maxdepth 1 -type d -print -quit)"
CLANG="$TOOLCHAIN/bin/aarch64-linux-android${ANDROID_API}-clang"
NM="$TOOLCHAIN/bin/llvm-nm"
READELF="$TOOLCHAIN/bin/llvm-readelf"
[[ -x "$CLANG" && -x "$NM" && -x "$READELF" ]] || {
  echo "Required NDK LLVM tools were not found" >&2
  exit 5
}
HEV_SYMBOLS="$($NM --dynamic --defined-only "$HEV_LIB" 2>/dev/null || true)"
for symbol in hev_socks5_tunnel_main hev_socks5_tunnel_quit hev_socks5_tunnel_stats; do
  grep -qw "$symbol" <<< "$HEV_SYMBOLS" || {
    echo "HEV stable API symbol missing: $symbol" >&2
    exit 5
  }
done
"$CLANG" -O2 -fPIC -shared -pthread -Wall -Wextra -Werror \
  -Wl,-soname,libaethertun.so -Wl,--no-undefined \
  -o "$OUT/libaethertun.so" "$ROOT/scripts/native/aethertun-jni.c" \
  -L"$(dirname "$HEV_LIB")" -lhev-socks5-tunnel -llog
"$READELF" -d "$OUT/libaethertun.so" | grep -q 'libhev-socks5-tunnel.so' || {
  echo "Aether JNI bridge is not linked to HEV" >&2
  exit 5
}
printf '%s\n' "$EXPECTED_STAMP" > "$STAMP"
echo "[android-native] Aether $AETHER_VERSION + HEV $HEV_VERSION ARM64 bundle prepared"
