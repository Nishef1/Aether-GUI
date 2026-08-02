#!/usr/bin/env bash
set -euo pipefail

REPO="SagerNet/sing-box"
DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="v1.13.12"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest-dir) DEST_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$DEST_DIR"
VERSION_FILE="$DEST_DIR/sing-box-version.txt"
TARGET="$DEST_DIR/sing-box"
if [[ -x "$TARGET" && -f "$VERSION_FILE" && "$(tr -d '\r\n' < "$VERSION_FILE")" == "$VERSION" ]]; then
  echo "[sidecar] sing-box $VERSION already prepared"
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  PLATFORM="linux-amd64" ;;
  Linux-aarch64) PLATFORM="linux-arm64" ;;
  Darwin-x86_64) PLATFORM="darwin-amd64" ;;
  Darwin-arm64)  PLATFORM="darwin-arm64" ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

HEADERS=(-H 'Accept: application/vnd.github+json' -H 'User-Agent: Aether-GUI-Sidecar-Installer')
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  HEADERS+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi
RELEASE_JSON="$(curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 60 \
  "${HEADERS[@]}" "https://api.github.com/repos/${REPO}/releases/tags/${VERSION}")"

META="$(printf '%s' "$RELEASE_JSON" | PLATFORM="$PLATFORM" EXPECTED_VERSION="$VERSION" node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  const r=JSON.parse(s); const tag=r.tag_name||"";
  if(tag!==process.env.EXPECTED_VERSION) process.exit(2);
  const v=tag.replace(/^v/,""); const name=`sing-box-${v}-${process.env.PLATFORM}.tar.gz`;
  const a=(r.assets||[]).find(x=>x.name===name);
  if(!a?.browser_download_url || !String(a.digest||"").startsWith("sha256:")) process.exit(2);
  process.stdout.write([name,a.browser_download_url,a.digest].join("\t"));
});
')" || { echo "Could not resolve sing-box $VERSION for $PLATFORM" >&2; exit 1; }
IFS=$'\t' read -r ASSET URL DIGEST <<< "$META"
EXPECTED="${DIGEST#sha256:}"

TMP_DIR="$(mktemp -d "${DEST_DIR%/}/.singbox-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
ARCHIVE="$TMP_DIR/$ASSET"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"
curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 180 \
  "${HEADERS[@]}" -o "$ARCHIVE" "$URL"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print tolower($1)}')"
else
  ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print tolower($1)}')"
fi
[[ "$ACTUAL" == "${EXPECTED,,}" ]] || { echo "Checksum mismatch for $ASSET" >&2; exit 1; }

tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
DOWNLOADED="$(find "$EXTRACT_DIR" -type f -name sing-box -print -quit)"
[[ -n "$DOWNLOADED" ]] || { echo "sing-box binary missing from $ASSET" >&2; exit 1; }
install -m 0755 "$DOWNLOADED" "$TARGET.new"
mv "$TARGET.new" "$TARGET"
printf '%s' "$VERSION" > "$VERSION_FILE"
echo "[sidecar] sing-box $VERSION installed and SHA-256 verified"
