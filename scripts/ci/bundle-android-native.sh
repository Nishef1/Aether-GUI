#!/usr/bin/env bash

set -euo pipefail

workspace=${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
destination="$workspace/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
core="$workspace/vendor/aether/aether/target/aarch64-linux-android/release/aether"
hev_library="$workspace/third-party/hev-socks5-tunnel/libs/arm64-v8a/libhev-socks5-tunnel.so"
tun_bridge="$workspace/third-party/hev-socks5-tunnel/libs/arm64-v8a/libaethertun.so"

[[ -x "$core" ]] || {
  echo "Aether ARM64 executable is missing: $core" >&2
  exit 2
}

[[ -f "$hev_library" ]] || {
  echo "hev-socks5-tunnel ARM64 library is missing: $hev_library" >&2
  exit 3
}

[[ -f "$tun_bridge" ]] || {
  echo "Aether stable TUN bridge is missing: $tun_bridge" >&2
  exit 4
}

mkdir -p "$destination"
cp "$core" "$destination/libaether_exec.so"
cp "$hev_library" "$destination/libhev-socks5-tunnel.so"
cp "$tun_bridge" "$destination/libaethertun.so"
chmod 755 "$destination/libaether_exec.so"

[[ -x "$destination/libaether_exec.so" ]]
[[ -f "$destination/libhev-socks5-tunnel.so" ]]
[[ -f "$destination/libaethertun.so" ]]

file "$destination"/*.so
ls -lah "$destination"
