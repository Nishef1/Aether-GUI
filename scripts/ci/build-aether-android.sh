#!/usr/bin/env bash

set -euo pipefail

: "${ANDROID_MIN_API:?ANDROID_MIN_API is required}"

workspace=${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
crate_dir="$workspace/vendor/aether/aether"
core="$crate_dir/target/aarch64-linux-android/release/aether"

[[ -f "$crate_dir/Cargo.toml" ]] || {
  echo "Aether Cargo.toml not found at $crate_dir/Cargo.toml" >&2
  exit 2
}

cd "$crate_dir"
cargo metadata --no-deps --format-version 1 >/dev/null
cargo ndk \
  --target arm64-v8a \
  --platform "$ANDROID_MIN_API" \
  build \
  --release \
  --bin aether

[[ -x "$core" ]] || {
  echo "Expected executable was not produced: $core" >&2
  exit 3
}

file "$core"
