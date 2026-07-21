# Aether-GUI

[![Release](https://img.shields.io/github/v/release/MatinSenPai/Aether-GUI?sort=semver)](https://github.com/MatinSenPai/Aether-GUI/releases)
[![License: AGPL v3](https://img.shields.io/github/license/MatinSenPai/Aether-GUI)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)

**English** · [فارسی](README_fa.md)

Aether-GUI is a desktop GUI for [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether), a censorship-circumvention client designed for heavily restricted networks. Aether discovers a working route, establishes the encrypted tunnel, and exposes a local SOCKS5 proxy. The GUI drives the real Aether core in a pseudo-terminal and can optionally place a supervised [sing-box](https://github.com/SagerNet/sing-box) TUN layer on top for system-wide routing.

The GUI and the Aether core have **independent release lifecycles**. A GUI release is not tied to one permanent core version.

## Features

- **One-click connection** — use the last successful profile or sensible defaults.
- **Advanced controls** — protocol, scan mode, IP version, MASQUE transport, obfuscation profile, quick reconnect, and local SOCKS port.
- **System-wide TUN mode** — optionally routes system traffic through `sing-box -> Aether SOCKS`. Administrator/root privileges are requested only when TUN mode is enabled.
- **Real TUN health supervision** — the GUI does not consider an alive `sing-box` process proof of a working tunnel. Startup and periodic checks verify the full data path; repeated failures tear down the broken chain and enter recovery instead of leaving the UI falsely connected.
- **Independent Aether core updates** — the app checks the latest stable Aether release separately from GUI updates. Downloads are verified against Aether's official `SHA256SUMS.txt`, installed into the app-data managed-core directory, and the bundled core remains a fallback.
- **Core capability detection** — before launching an independently updated core, the GUI reads `aether --help` and avoids blindly forwarding CLI flags that the active core no longer advertises.
- **Verified TUN dependencies** — sing-box release assets require a SHA-256 digest. On Windows, Wintun is accepted from the verified sing-box archive or from the official Wintun distribution after SHA-256 and Authenticode verification.
- **Persistent diagnostics** — Aether output, sing-box output, state changes, updater events, TUN health failures, and Rust panics are written to a rotating JSONL diagnostics file. Obvious credential-bearing lines are redacted before persistent storage.
- **Automatic recovery** — unexpected Aether or TUN failures are supervised as one connection lifecycle with bounded retries.
- **Crash-safe process cleanup** — orphan cleanup validates both the saved PID and expected process identity before force-killing anything. It never kills every `sing-box.exe` process on the machine.
- **Local-only SOCKS proxy** — the GUI deliberately binds Aether's unauthenticated SOCKS server to loopback. Older saved `0.0.0.0`/LAN profiles are sanitized back to `127.0.0.1` while preserving their port.

## Connection model

Without TUN:

```text
Aether core -> local SOCKS5 (127.0.0.1:1819 by default) -> applications configured to use SOCKS
```

With TUN:

```text
System traffic -> sing-box TUN -> Aether SOCKS5 -> Aether encrypted tunnel -> internet
```

The high-level state flow is:

```text
Idle -> Launching -> Connecting -> Connected
                                  -> Tunneling   (when system-wide TUN is enabled and verified)
```

`Connected` means the Aether SOCKS endpoint is ready. `Tunneling` means the full system-wide path has passed an end-to-end health check.

## Aether core updates

At startup, Aether-GUI performs a best-effort background check for the latest **stable** Aether release. The managed core lives under the application's data directory and takes precedence over the bundled fallback.

Safety rules:

1. The GUI never activates an unverified core download.
2. Aether release archives are checked against the release's official `SHA256SUMS.txt`.
3. Verified cores are installed side-by-side under immutable versioned filenames such as `aether-vX.Y.Z.exe`; a small version pointer is switched atomically for future connections, so a background update never modifies the binary used by an already-running tunnel.
4. Older versioned cores are left intact, and a tested core bundled with the GUI remains available as a recovery fallback.
5. If the update service is unreachable, the currently managed or bundled core continues to work.
6. On a true first run with no usable core, pressing Connect performs the verified fetch synchronously instead of racing the background updater.

Because the core can advance independently, launch arguments are filtered using the active core's own `--help` output. The existing pseudo-terminal prompt handler remains as a compatibility fallback.

## TUN mode and privileges

TUN mode uses sing-box with automatic routing and interface detection. On Windows, strict routing is enabled to reduce DNS leakage from the multi-homed DNS behavior of the OS. Strict routing can conflict with some virtual-network software, so if TUN mode fails, check the diagnostics log and test without conflicting virtual adapters.

The normal proxy-only mode does **not** require elevation. When TUN is enabled and you press Connect, the app requests elevation on demand and resumes the pending connection after relaunch.

The TUN supervisor continuously drains both `stdout` and `stderr` from sing-box, validates its configuration before launch, checks process health, and periodically probes the actual data path. After three consecutive data-path failures, the broken TUN/Aether chain is torn down and recovery is attempted.

## Diagnostics

Persistent diagnostics are stored in the app-data directory:

```text
logs/aether-gui.jsonl
logs/aether-gui.jsonl.1   # previous rotated log
```

The active file rotates at approximately 5 MiB. Each line is JSON containing a timestamp, component, level, and message.

The log records:

- GUI startup/version/OS/architecture
- Aether core version and path
- core update activity
- Aether output
- sing-box output
- connection state transitions
- TUN health checks and failures
- recovery attempts
- Rust panics and application exit

Lines containing obvious secrets such as authorization headers, bearer tokens, access tokens, private keys, passwords, or similar credential markers are replaced with a redacted placeholder before being written to disk.

## Installing a release

For normal use, install a release build from the upstream project's Releases page. Windows x64 is the primary packaged target at the moment.

## Building from source

### 1. Prerequisites

- [Node.js](https://nodejs.org/) and npm
- [Rust stable via rustup](https://rustup.rs/)
- [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)
  - Windows: Microsoft C++ Build Tools / Windows SDK and WebView2 Runtime
  - macOS: Xcode Command Line Tools
  - Linux: the WebKitGTK and system packages required by Tauri

Confirm Rust is available:

```sh
rustc --version
cargo --version
```

### 2. Install frontend dependencies

```sh
npm install
```

### 3. Fetch verified fallback binaries

Fetching binaries before a release build gives the application an offline fallback in addition to its runtime managed-core updater.

Windows:

```powershell
npm run fetch:binaries:windows
```

Linux/macOS:

```sh
npm run fetch:binaries:unix
```

The Aether fetcher resolves the latest stable release dynamically and verifies `SHA256SUMS.txt`. The sing-box fetcher resolves the latest stable release dynamically and verifies the release asset digest.

### 4. Run in development mode

```sh
npm run tauri dev
```

### 5. Build installers

```sh
npm run tauri build
```

Bundles are generated under `src-tauri/target/release/bundle/`.

## Local validation

Run these before submitting changes:

```sh
npm run typecheck
npm run lint
npm run check:rust
npm run test:rust
npm run clippy:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

For dependency vulnerability auditing, install `cargo-audit` once and run it against the Rust project:

```sh
cargo install cargo-audit
cargo audit --file src-tauri/Cargo.lock
```

For an end-to-end TUN test on Windows:

1. Start the app normally, not as Administrator.
2. Enable **System-wide TUN** in Advanced.
3. Press Connect and accept the UAC prompt.
4. Wait for **Protected system-wide**, which is emitted only after the data-path probe succeeds.
5. Keep the connection active long enough to exercise periodic health checks.
6. Disconnect during both normal operation and TUN startup to verify cancellation cleanup.
7. Review `aether-gui.jsonl` for the complete state/process/health sequence.

## Security notes

- Aether's SOCKS endpoint is intentionally loopback-only in this GUI because the core SOCKS server does not provide proxy authentication.
- External binaries are not trusted solely because they downloaded successfully; the fetch paths perform integrity/signature verification before installation.
- TUN elevation is requested only when needed. The regular application path remains non-elevated.
- The WebView CSP blocks objects, frames, base URL changes, and form submissions in addition to the default same-origin restrictions.
- The project supervises only processes it owns; broad process-name killing is intentionally avoided.

## Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Zustand, Motion.
- **Desktop shell/backend:** Tauri 2 + Rust.
- **Aether process:** spawned in a real pseudo-terminal using `portable-pty` so current and fallback interactive behavior can be handled safely.
- **TUN process:** sing-box is spawned as a separately supervised child with continuously drained output and pre-launch config validation.
- **Ground truth:** local SOCKS readiness is a connection milestone; system-wide TUN requires a separate end-to-end data-path check.

## About Aether

Aether-GUI does not reimplement Aether's censorship-circumvention protocols. The actual MASQUE, WireGuard, gool/WARP-in-WARP, endpoint discovery, obfuscation, data-plane validation, and tunnel behavior belong to [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether).

## License

[GNU Affero General Public License v3.0](LICENSE).
