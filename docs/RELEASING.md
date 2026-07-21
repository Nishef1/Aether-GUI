# Releasing Aether-GUI

## Distribution and update model

The public Windows artifact is the NSIS Setup EXE under `src-tauri/target/release/bundle/nsis/`, never the raw Cargo executable. It contains Aether `v1.3.0`, sing-box `v1.13.14`, `wintun.dll`, `libcronet.dll` when supplied by the selected sing-box build, executable fallback aliases, and version metadata. The first launch therefore works offline.

Core updates remain independent. The Core Registry verifies and installs exact versioned binaries side-by-side in AppData, switches its active pointer only after success, and keeps the bundled baseline as a recovery fallback.

Application updates use Tauri's signed updater only. Normal, disconnected, non-elevated clients check the official stable endpoint every six hours. An available app update takes priority over core updates; the title bar downloads with progress, verifies the Tauri signature, installs, and relaunches. Updating is disabled while connected or elevated. This updater signature is separate from optional Windows Authenticode code signing.

## One-time updater key setup

Generate and back up the private key on a trusted machine, outside this repository:

```powershell
pnpm tauri signer generate -- -w "$HOME/.tauri/aether-gui.key"
```

Never commit the private key or its password. Only insert the generated public-key content into `src-tauri/tauri.conf.json` at `plugins.updater.pubkey`, with the official endpoint:

```json
"plugins": {
  "updater": {
    "pubkey": "<generated public-key content>",
    "endpoints": ["https://github.com/Nishef1/Aether-GUI/releases/latest/download/latest.json"]
  }
}
```

This is deliberately the sole remaining configuration step until a real public key exists. Do not use a placeholder. The repository ignores local `.tauri/`, `.env*`, `.key`, and `.pem` files.

## Local Windows release

```powershell
pnpm install
pnpm release:windows
```

`release:windows` validates TypeScript/Rust/version synchronization, prepares the pinned cores, verifies all required runtime resources, requires `TAURI_SIGNING_PRIVATE_KEY`, and builds the signed NSIS updater artifact. Set these environment variables only in your secure local shell or CI secret store:

- `TAURI_SIGNING_PRIVATE_KEY` — private-key content (GitHub Actions commonly receives the content, not merely a file path).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password if the key was encrypted.

For a local, non-updater test build only:

```powershell
pnpm build:windows:setup:unsigned
```

The signed build emits `*-setup.exe` and `*-setup.exe.sig` in `src-tauri/target/release/bundle/nsis/`. The Tauri GitHub Action uploads those assets and generates/uploads `latest.json`, whose `windows-x86_64` entry points to the signed NSIS artifact.

## Version and GitHub release flow

1. Bump the same SemVer in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run `pnpm validate`, `pnpm prepare:cores:windows`, and `pnpm verify:bundled-cores:windows`.
3. Commit, then push a matching tag such as `v0.5.1`.
4. The single `release-windows` workflow runs only for tags or manual dispatch, verifies signing secrets, creates/updates a draft GitHub Release, and uploads the NSIS EXE, updater artifact/signature, and `latest.json`.
5. Test the draft on a clean profile before publishing it as the latest stable release. Do not publish prereleases to this endpoint.

## Manual update test plan

1. Install `v0.5.0` on a clean Windows profile, disable networking, and confirm bundled cores work in Proxy, Tunnel, and Both modes (including Wintun).
2. Publish a signed test `v0.5.1` draft/release with the generated `latest.json`.
3. Launch `v0.5.0` normally, reconnect networking, confirm `Update app`, progress, signature rejection for an invalid artifact, successful install/relaunch, version `v0.5.1`, and preservation of settings, identities, managed cores, pointers, and diagnostics preferences.
4. Confirm core updates still work independently afterwards, and that neither check nor install runs from an elevated process.
