# Aether-GUI

[![Release](https://img.shields.io/github/v/release/Nishef1/Aether-GUI?sort=semver)](https://github.com/Nishef1/Aether-GUI/releases)
[![License: AGPL v3](https://img.shields.io/github/license/Nishef1/Aether-GUI)](LICENSE)
![Desktop](https://img.shields.io/badge/desktop-Windows%20%7C%20Linux%20%7C%20macOS-555)
![Android](https://img.shields.io/badge/Android-arm64--v8a-3DDC84?logo=android&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)

**English** · [فارسی](README_fa.md)

Aether-GUI is an independent, mobile-first graphical client around the official [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) transport core. It keeps transport logic in the upstream core and adds a platform-neutral connection UI, full-device tunnelling, lifecycle management, telemetry and safe interactive Zero Trust authentication.

`main` currently pins **Aether v1.9.0** (`311b573352bb67e494895ff67d20b002d075116a`). Runtime versions live in one source of truth: [`scripts/runtime-versions.json`](scripts/runtime-versions.json).

> **Release status:** the published `v0.7.2` assets predate the current Aether 1.9/mobile-first work on `main`. Do not assume those older binaries contain the runtime and UI changes documented below. New release artifacts are published only after explicit manual validation.

## What it supports

- **MASQUE over HTTP/3 or HTTP/2** with Aether obfuscation profiles, ECH and optional H2 ClientHello fragmentation.
- **WireGuard** and **WARP-in-WARP (gool)**, including Aether 1.9 manual two-hop endpoints and two-hop scanning.
- **Aether 1.9 proxy features**: optional local HTTP CONNECT listener and outbound SOCKS5/HTTP upstream chaining.
- **DNS and routing rules**, with Aether domain sniffing enabled by default so name-based routing can keep working behind a TUN.
- **Cloudflare Zero Trust** email-code, service-token and pre-obtained-token flows. Secrets and credential-bearing upstream URLs are session-only and are stripped before profiles are persisted.
- **Real connection verification**: the GUI does not treat a log message as success. Android verifies reusable SOCKS egress before starting its device TUN; desktop verifies the transport endpoint and the selected system tunnel independently.
- **Full-device protection by default**:
  - Android: `VpnService` + HEV tun2socks, always app-managed as the normal connection path.
  - Desktop: pinned sing-box TUN adapter, enabled by default on a new installation and still explicitly disableable by the user.
- **Mobile-first UI** with Android safe-area handling, 48dp-class primary touch targets, reduced continuous animation and visibility-aware polling.
- **Opt-in diagnostics**: Android live logs are bounded, memory-only and disabled by default.

## Platforms

The build contract covers:

- Windows x86_64
- Linux x86_64
- macOS arm64
- macOS x86_64
- Android arm64-v8a

Android is intentionally ARM64-first. The native bundle contains the official Aether Android ARM64 executable, HEV and the local JNI bridge.

## Architecture

Transport and operating-system tunnelling are separate boundaries:

```text
React / Tauri IPC
       |
EngineRuntime
       |-- Aether EngineAdapter -> loopback SOCKS5
       |
       `-- SystemTunnelRuntime
             |-- desktop: sing-box TUN
             `-- Android: VpnService + HEV
```

The GUI does **not** carry private protocol patches for MASQUE/WireGuard/gool. Protocol correctness belongs in [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full boundary and upgrade policy.

## Development

### Desktop

Prerequisites: Node.js/npm, stable Rust and the normal [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run verify:runtimes
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- dev
```

`npm run prepare:aether` fetches the pinned official core for the current desktop platform and verifies the published checksum. `npm run prepare:sidecars` prepares the pinned desktop sing-box/Wintun runtime where applicable.

### Android ARM64

Android additionally requires JDK 17, Android SDK 36, NDK `28.2.13676358`, Bash and Rust target `aarch64-linux-android`.

```sh
npm ci
npm run android:init
npm run prepare:android-native
npm run android:build
```

`android:init` may regenerate Tauri's Android project. Persistent Android customisation therefore lives in source/plugin files and deterministic scripts such as `scripts/apply-android-branding.mjs`, not in one-off edits to generated resources.

More detail: [`docs/BUILD.md`](docs/BUILD.md).

## Build / release policy

`.github/workflows/build.yml` is **manual-only** (`workflow_dispatch`). It does not run on push or tags and it does not create/update GitHub Releases. This is intentional: runtime/device validation is performed explicitly before publishing.

The current release checklist includes Windows connection/disconnect/reconnect, desktop system TUN, Android permission/service lifecycle, repeated Android connect/disconnect, foreground/background behavior, MASQUE H2/H3, WireGuard, gool, DNS/routing, exit-IP/data-plane verification and signed ARM64 package validation.

## Security notes

- Credential-bearing upstream proxy URLs are never placed in process command-line arguments or persisted connection profiles.
- Zero Trust secrets and one-time codes are never stored in the saved successful profile.
- Android does not expose its local SOCKS listener to the LAN.
- Desktop LAN SOCKS binding is an explicit expert choice and exposes an unauthenticated proxy to the local network.
- Logs are supplementary diagnostics; they are not connection ground truth.

## Project lineage and upstream naming

This repository originated from the MatinSenPai Aether-GUI line, but the current runtime/UI architecture is maintained independently. Matin's repository is historical reference, not the operational upstream for current development. The transport upstream is **CluvexStudio/Aether**.

Before public distribution under the **Aether** name/logo, review the upstream project's current [`TRADEMARK.md`](https://github.com/CluvexStudio/Aether/blob/main/TRADEMARK.md). If permission is required and is not available, the client should be rebranded before a new public release; this repository does not silently assume trademark permission.

## License

[GNU Affero General Public License v3.0](LICENSE).
