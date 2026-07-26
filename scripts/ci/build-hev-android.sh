#!/usr/bin/env bash

set -euo pipefail

: "${ANDROID_MIN_API:?ANDROID_MIN_API is required}"
: "${HEV_SOCKS5_TUNNEL_COMMIT:?HEV_SOCKS5_TUNNEL_COMMIT is required}"
: "${NDK_HOME:?NDK_HOME is required}"

workspace=${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
source_dir="$workspace/third-party/hev-socks5-tunnel"
hev_library="$source_dir/libs/arm64-v8a/libhev-socks5-tunnel.so"
native_bridge_source="$workspace/scripts/native/aethertun-jni.c"
native_bridge_library="$source_dir/libs/arm64-v8a/libaethertun.so"

rm -rf "$source_dir"
mkdir -p "$(dirname "$source_dir")"

git clone \
  --filter=blob:none \
  --no-checkout \
  https://github.com/heiher/hev-socks5-tunnel.git \
  "$source_dir"

git -C "$source_dir" checkout "$HEV_SOCKS5_TUNNEL_COMMIT"
git -C "$source_dir" submodule update --init --recursive --depth 1

actual_commit=$(git -C "$source_dir" rev-parse HEAD)
[[ "$actual_commit" == "$HEV_SOCKS5_TUNNEL_COMMIT" ]] || {
  echo "Pinned hev-socks5-tunnel commit mismatch: $actual_commit" >&2
  exit 2
}

[[ -f "$native_bridge_source" ]] || {
  echo "Aether TUN bridge source is missing: $native_bridge_source" >&2
  exit 3
}

# Never ship hev's RegisterNatives/JNI_OnLoad layer. Its Kotlin signatures have
# changed between upstream revisions and couple the app to an unstable JNI ABI.
# Aether-GUI binds only the stable hev-main.h C API through libaethertun.so.
while IFS= read -r -d '' makefile; do
  sed -i.aetherbak 's|[^[:space:]]*hev-jni\.c||g' "$makefile"
  rm -f "$makefile.aetherbak"
done < <(find "$source_dir" -name '*.mk' -print0)
find "$source_dir" -name 'hev-jni.c' -delete

cat > "$source_dir/Application.mk" <<EOF
APP_OPTIM := release
APP_PLATFORM := android-${ANDROID_MIN_API}
APP_ABI := arm64-v8a
APP_CFLAGS := -O3
APP_STL := c++_static
APP_SUPPORT_FLEXIBLE_PAGE_SIZES := true
NDK_TOOLCHAIN_VERSION := clang
EOF

"$NDK_HOME/ndk-build" \
  -C "$source_dir" \
  NDK_PROJECT_PATH=. \
  APP_BUILD_SCRIPT=Android.mk \
  NDK_APPLICATION_MK=Application.mk

[[ -f "$hev_library" ]] || {
  echo "Expected hev core library was not produced: $hev_library" >&2
  exit 4
}

toolchain_dir=$(find "$NDK_HOME/toolchains/llvm/prebuilt" -mindepth 1 -maxdepth 1 -type d | head -n 1)
[[ -n "$toolchain_dir" ]] || {
  echo "Android NDK LLVM toolchain was not found under $NDK_HOME" >&2
  exit 5
}

clang="$toolchain_dir/bin/aarch64-linux-android${ANDROID_MIN_API}-clang"
llvm_nm="$toolchain_dir/bin/llvm-nm"
llvm_readelf="$toolchain_dir/bin/llvm-readelf"
[[ -x "$clang" && -x "$llvm_nm" && -x "$llvm_readelf" ]] || {
  echo "Required NDK LLVM tools are missing from $toolchain_dir/bin" >&2
  exit 6
}

hev_symbols=$($llvm_nm --dynamic --defined-only "$hev_library" 2>/dev/null || true)
for symbol in \
  hev_socks5_tunnel_main \
  hev_socks5_tunnel_quit \
  hev_socks5_tunnel_stats; do
  grep -qw "$symbol" <<<"$hev_symbols" || {
    echo "hev core does not export stable C API symbol: $symbol" >&2
    exit 7
  }
done

if grep -qw 'JNI_OnLoad' <<<"$hev_symbols"; then
  echo "hev core still exports JNI_OnLoad; bundled hev JNI was not removed" >&2
  exit 8
fi

"$clang" \
  -O2 \
  -fPIC \
  -shared \
  -pthread \
  -Wall \
  -Wextra \
  -Werror \
  -Wl,-soname,libaethertun.so \
  -Wl,--no-undefined \
  -o "$native_bridge_library" \
  "$native_bridge_source" \
  -L"$(dirname "$hev_library")" \
  -lhev-socks5-tunnel \
  -llog

bridge_symbols=$($llvm_nm --dynamic --defined-only "$native_bridge_library" 2>/dev/null || true)
for symbol in \
  JNI_OnLoad \
  Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStart \
  Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStop \
  Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStats; do
  grep -qw "$symbol" <<<"$bridge_symbols" || {
    echo "Aether TUN bridge does not export required symbol: $symbol" >&2
    exit 9
  }
done

$llvm_readelf -d "$native_bridge_library" | grep -q 'libhev-socks5-tunnel.so' || {
  echo "libaethertun.so is not linked to libhev-socks5-tunnel.so" >&2
  exit 10
}

file "$hev_library" "$native_bridge_library"
$llvm_readelf -d "$hev_library" | grep NEEDED || true
$llvm_readelf -d "$native_bridge_library" | grep NEEDED || true
