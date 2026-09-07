#!/usr/bin/env bash
# Downloads the pinned official Aether core for the current desktop platform.
# Linux uses the musl build so the bundled core is not tied to a distro glibc.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST_DIR="$ROOT/src-tauri/binaries"
VERSIONS="$ROOT/scripts/runtime-versions.json"

for tool in node curl tar; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "$tool is required to prepare the Aether core" >&2
    exit 2
  }
done

AETHER_VERSION="$(node -e '
const fs=require("fs");
const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).aether?.version;
if(!/^v\d+\.\d+\.\d+$/.test(v||"")) process.exit(2);
process.stdout.write(v);
' "$VERSIONS")" || {
  echo "Invalid Aether version in scripts/runtime-versions.json" >&2
  exit 2
}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)   DEFAULT_ASSET="aether-linux-x86_64-musl.tar.gz" ;;
  Linux-aarch64)  DEFAULT_ASSET="aether-linux-aarch64-musl.tar.gz" ;;
  Darwin-x86_64)  DEFAULT_ASSET="aether-macos-x86_64.tar.gz" ;;
  Darwin-arm64)   DEFAULT_ASSET="aether-macos-arm64.tar.gz" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m). Use fetch-aether.ps1 on Windows." >&2
    exit 1
    ;;
esac

ASSET="${AETHER_ASSET:-$DEFAULT_ASSET}"
REPO="CluvexStudio/Aether"
TARGET="$DEST_DIR/aether"
STAMP="$DEST_DIR/aether-version.txt"
EXPECTED_VERSION="${AETHER_VERSION#v}"

mkdir -p "$DEST_DIR"

verify_binary_version() {
  local output
  output="$("$TARGET" --version 2>/dev/null || true)"
  [[ "$output" == *"$EXPECTED_VERSION"* ]]
}

if [[ -x "$TARGET" && -f "$STAMP" && "$(tr -d '\r\n ' < "$STAMP")" == "$AETHER_VERSION" ]]; then
  if verify_binary_version; then
    echo "[core] Aether $AETHER_VERSION already prepared"
    exit 0
  fi
  echo "[core] Existing Aether stamp matched but binary version did not; replacing it" >&2
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aether-core.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
ARCHIVE="$TMP/$ASSET"
SUMS="$TMP/SHA256SUMS.txt"
BASE_URL="https://github.com/${REPO}/releases/download/${AETHER_VERSION}"

curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 180 \
  "$BASE_URL/$ASSET" -o "$ARCHIVE"
curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 60 \
  "$BASE_URL/SHA256SUMS.txt" -o "$SUMS"

EXPECTED_SHA="$(
  awk -v asset="$ASSET" '
    {
      name=$2
      sub(/^\*/, "", name)
      if (name == asset) {
        print tolower($1)
        exit
      }
    }
  ' "$SUMS"
)"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Aether checksum entry was not found for $ASSET" >&2
  exit 3
}

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print tolower($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print tolower($1)}')"
else
  echo "sha256sum or shasum is required" >&2
  exit 2
fi

[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || {
  echo "Checksum verification failed for $ASSET" >&2
  exit 3
}

EXTRACT="$TMP/extract"
mkdir -p "$EXTRACT"
tar -xzf "$ARCHIVE" -C "$EXTRACT"
DOWNLOADED="$(find "$EXTRACT" -type f -name aether -print -quit)"
[[ -n "$DOWNLOADED" ]] || {
  echo "Aether executable was not found in $ASSET" >&2
  exit 3
}

install -m 0755 "$DOWNLOADED" "$TARGET.new"
mv -f "$TARGET.new" "$TARGET"

if ! verify_binary_version; then
  echo "Downloaded Aether binary did not report expected version $EXPECTED_VERSION" >&2
  rm -f "$TARGET"
  exit 3
fi

printf '%s\n' "$AETHER_VERSION" > "$STAMP"
echo "[core] Aether $AETHER_VERSION ready from $ASSET"
