#!/usr/bin/env bash

set -euo pipefail

: "${ANDROID_MIN_API:?ANDROID_MIN_API is required}"
: "${HEV_SOCKS5_TUNNEL_COMMIT:?HEV_SOCKS5_TUNNEL_COMMIT is required}"
: "${NDK_HOME:?NDK_HOME is required}"

workspace=${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
source_dir="$workspace/third-party/hev-socks5-tunnel"
bridge="$source_dir/libs/arm64-v8a/libhev-socks5-tunnel.so"

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

cat > "$source_dir/Application.mk" <<EOF
APP_OPTIM := release
APP_PLATFORM := android-${ANDROID_MIN_API}
APP_ABI := arm64-v8a
APP_CFLAGS := -O3 -DPKGNAME=com/cluvexstudio/aethergui/vpn -DCLSNAME=HevTun2Socks
APP_SUPPORT_FLEXIBLE_PAGE_SIZES := true
NDK_TOOLCHAIN_VERSION := clang
EOF

"$NDK_HOME/ndk-build" \
  -C "$source_dir" \
  NDK_PROJECT_PATH=. \
  APP_BUILD_SCRIPT=Android.mk \
  NDK_APPLICATION_MK=Application.mk

[[ -f "$bridge" ]] || {
  echo "Expected tun2socks bridge was not produced: $bridge" >&2
  exit 3
}

file "$bridge"
