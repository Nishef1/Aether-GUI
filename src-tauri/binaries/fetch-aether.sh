#!/usr/bin/env bash
# Downloads the latest stable Aether release for the current platform and
# verifies it against the release's SHA256SUMS.txt. The destination can be
# overridden for the GUI's runtime-managed core directory.
set -euo pipefail

REPO="CluvexStudio/Aether"
DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest-dir)
      DEST_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$DEST_DIR"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)   ASSET="aether-linux-x86_64.tar.gz" ;;
  Linux-aarch64)  ASSET="aether-linux-arm64.tar.gz" ;;
  Darwin-x86_64)  ASSET="aether-macos-x86_64.tar.gz" ;;
  Darwin-arm64)   ASSET="aether-macos-arm64.tar.gz" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m). On native Windows use fetch-aether.ps1." >&2
    exit 1
    ;;
esac

# Cross-build override: the bundled core must match the target, not host.
ASSET="${AETHER_ASSET:-$ASSET}"

API_URL="https://api.github.com/repos/${REPO}/releases/latest"
LATEST_JSON="$(curl -fsSL -H 'User-Agent: Aether-GUI-Core-Updater' "$API_URL")"
AETHER_VERSION="$(printf '%s' "$LATEST_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
if [[ -z "$AETHER_VERSION" ]]; then
  echo "Could not determine latest Aether release tag" >&2
  exit 1
fi

TARGET="$DEST_DIR/aether"
VERSION_FILE="$DEST_DIR/aether-version.txt"
if [[ -x "$TARGET" && -f "$VERSION_FILE" && "$(tr -d '\r\n' < "$VERSION_FILE")" == "$AETHER_VERSION" ]]; then
  echo "[core-updater] Aether $AETHER_VERSION is already installed"
  exit 0
fi

URL="https://github.com/${REPO}/releases/download/${AETHER_VERSION}/${ASSET}"
SUMS_URL="https://github.com/${REPO}/releases/download/${AETHER_VERSION}/SHA256SUMS.txt"
TMP_DIR="$(mktemp -d "${DEST_DIR%/}/.aether-update.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE="$TMP_DIR/$ASSET"
SUMS="$TMP_DIR/SHA256SUMS.txt"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"

echo "[core-updater] Downloading Aether $AETHER_VERSION..."
curl -fL --retry 2 -H 'User-Agent: Aether-GUI-Core-Updater' -o "$ARCHIVE" "$URL"
curl -fL --retry 2 -H 'User-Agent: Aether-GUI-Core-Updater' -o "$SUMS" "$SUMS_URL"

EXPECTED="$(awk -v asset="$ASSET" '$2 == asset { print tolower($1); exit }' "$SUMS")"
if [[ -z "$EXPECTED" ]]; then
  echo "No checksum entry found for $ASSET" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print tolower($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print tolower($1)}')"
else
  echo "Neither sha256sum nor shasum is available" >&2
  exit 1
fi

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "Checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL)" >&2
  exit 1
fi
echo "[core-updater] SHA-256 verified"

tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
DOWNLOADED="$(find "$EXTRACT_DIR" -type f -name aether -print -quit)"
if [[ -z "$DOWNLOADED" ]]; then
  echo "aether binary not found inside $ASSET" >&2
  exit 1
fi
chmod +x "$DOWNLOADED"

NEW_TARGET="$TARGET.new"
BACKUP_TARGET="$TARGET.old"
rm -f "$NEW_TARGET" "$BACKUP_TARGET"
cp "$DOWNLOADED" "$NEW_TARGET"
chmod +x "$NEW_TARGET"

if [[ -e "$TARGET" ]]; then
  mv "$TARGET" "$BACKUP_TARGET"
fi
if mv "$NEW_TARGET" "$TARGET"; then
  printf '%s' "$AETHER_VERSION" > "$VERSION_FILE"
  rm -f "$BACKUP_TARGET"
else
  rm -f "$TARGET"
  [[ -e "$BACKUP_TARGET" ]] && mv "$BACKUP_TARGET" "$TARGET"
  exit 1
fi

echo "[core-updater] Aether core updated to $AETHER_VERSION"
