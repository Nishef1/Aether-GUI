#!/usr/bin/env bash

set -euo pipefail

workspace=${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
destination="$workspace/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
core="$workspace/vendor/aether/aether/target/aarch64-linux-android/release/aether"
bridge="$workspace/third-party/hev-socks5-tunnel/libs/arm64-v8a/libhev-socks5-tunnel.so"

[[ -x "$core" ]] || {
  echo "Aether ARM64 executable is missing: $core" >&2
  exit 2
}

[[ -f "$bridge" ]] || {
  echo "tun2socks ARM64 library is missing: $bridge" >&2
  exit 3
}

mkdir -p "$destination"
cp "$core" "$destination/libaether_exec.so"
cp "$bridge" "$destination/libhev-socks5-tunnel.so"
chmod 755 "$destination/libaether_exec.so"

[[ -x "$destination/libaether_exec.so" ]]
[[ -f "$destination/libhev-socks5-tunnel.so" ]]

file "$destination"/*.so
ls -lah "$destination"
