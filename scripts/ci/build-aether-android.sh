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

# Validate the source contract before mutating the checked-out submodule. This
# guards patch ordering, default flags, scanner bounds, MTUs, and egress gating.
python3 "$workspace/scripts/tests/test_android_transport_contract.py"

# Keep CI and the local PowerShell build on the same deterministic core source.
# The baseline fresh-session migration runs first; the final patches then layer
# Android's verified egress, runtime DNS, bounded discovery, and fresh runtime
# policy in the same order as prepare-android-native-final.ps1.
patches=(
  "scripts/ci/patch-aether-wg-fresh-session.py"
  "scripts/ci/patch-aether-wg-real-egress.py"
  "scripts/ci/patch-aether-wg-runtime-resolver.py"
  "scripts/ci/remove-aether-wg-core-readiness-gate.py"
  "scripts/ci/patch-aether-mobile-network-policy.py"
  "scripts/ci/patch-aether-android-fresh-runtime.py"
)

for relative_patch in "${patches[@]}"; do
  patch="$workspace/$relative_patch"
  [[ -f "$patch" ]] || {
    echo "Required Android core patch is missing: $patch" >&2
    exit 2
  }
  python3 "$patch" "$workspace"
done

# setup-android may expose its own default NDK through ANDROID_NDK_ROOT. Keep
# cargo-ndk pinned to the exact NDK selected by the workflow.
if [[ -n "${NDK_HOME:-}" ]]; then
  export ANDROID_NDK_HOME="$NDK_HOME"
  export ANDROID_NDK_ROOT="$NDK_HOME"
fi

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
