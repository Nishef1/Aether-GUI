# Releasing Aether-GUI

## Distribution and update model

The public Windows artifact is the NSIS Setup EXE under `src-tauri/target/release/bundle/nsis/`, never the raw Cargo executable. It contains Aether `v1.4.0`, Xray-core `v26.5.9`, sing-box `v1.13.14`, verified `wintun.dll`, `libcronet.dll` when supplied by the selected sing-box build, executable fallback aliases, installer helpers, and version metadata. The first launch therefore works offline.

Core updates remain independent. The Core Registry verifies and installs exact versioned binaries side-by-side in AppData, switches its active pointer only after success, and keeps each bundled baseline as a recovery fallback.

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

`release:windows` validates TypeScript/Rust/version synchronization, prepares the pinned Aether/Xray/sing-box/Wintun resources, verifies all required runtime files, requires `TAURI_SIGNING_PRIVATE_KEY`, and builds the signed NSIS updater artifact. Set these environment variables only in your secure local shell or CI secret store:

- `TAURI_SIGNING_PRIVATE_KEY` — private-key content (required for GitHub Actions, which receives the content rather than a filesystem path).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password if the key was encrypted.

For a local build, Tauri also supports `TAURI_SIGNING_PRIVATE_KEY_PATH` with the path to the private-key file.

For a local, non-updater test build only:

```powershell
pnpm build:windows:setup:unsigned
```

The signed build emits `*-setup.exe` and `*-setup.exe.sig` in `src-tauri/target/release/bundle/nsis/`. The Tauri GitHub Action uploads those assets and generates/uploads `latest.json`, whose `windows-x86_64` entry points to the signed NSIS artifact.

## Version and GitHub release flow

1. Bump the same SemVer in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run `pnpm validate`, `pnpm prepare:cores:windows`, and `pnpm verify:bundled-cores:windows`.
3. Run the clean-machine TUN smoke matrix below before tagging.
4. Commit, then push a matching tag such as `v0.5.3`.
5. The single `release-windows` workflow runs only for tags or manual dispatch, verifies signing secrets, creates/updates a draft GitHub Release, and uploads the NSIS EXE, updater artifact/signature, and `latest.json`.
6. Test the draft on a clean profile before publishing it as the latest stable release. Do not publish prereleases to this endpoint.

## Required Windows TUN smoke matrix

Test on a clean Windows profile with no managed cores or old Wintun DLLs:

1. Confirm the setup installs all four pinned baselines and Settings reports their exact versions.
2. Connect in Proxy mode with MASQUE HTTP/2 and verify the loopback SOCKS path.
3. Connect in Tunnel mode with Xray and verify:
   - `xray run -test` succeeds before routes are accepted;
   - the Wintun adapter receives IPv4/IPv6 gateways and DNS;
   - hostname resolution works through the system route;
   - IPv4 health verification succeeds;
   - IPv6 is either verified or correctly reported unavailable;
   - Aether and Xray do not recurse into the TUN.
4. Repeat Tunnel mode with sing-box as the explicit fallback and record whether Windows DNS is supported on that host.
5. Repeat at least one run for Aether WireGuard and gool. Remember that these protocols are inside Aether; changing Xray versus sing-box only changes system routing above Aether SOCKS.
6. Disconnect and confirm routes, DNS, adapter and owned child processes are removed.
7. Force-close during TUN operation, relaunch, and confirm orphan cleanup only terminates the owned PID and never kills unrelated processes by image name.

## Manual application-update test plan

1. Install the previous stable version on a clean Windows profile, disable networking, and confirm bundled cores work in Proxy mode and Xray Tunnel mode.
2. Publish a signed test draft/release with the generated `latest.json`.
3. Launch the previous version normally, reconnect networking, confirm `Update app`, progress, signature rejection for an invalid artifact, successful install/relaunch, the new version number, and preservation of settings, identities, managed cores, pointers, and diagnostics preferences.
4. Confirm Aether, Xray and sing-box updates still work independently afterwards, and that neither check nor install runs from an elevated process.
