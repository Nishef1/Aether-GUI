# Aether-GUI

[![License: AGPL v3](https://img.shields.io/github/license/Nishef1/Aether-GUI)](LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)

**English** · [فارسی](README_fa.md)

Aether-GUI is a lightweight desktop control plane around the real [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) core. For system-wide routing it can place either a native [Xray-core](https://github.com/XTLS/Xray-core) TUN layer (recommended on Windows) or a supervised [sing-box](https://github.com/SagerNet/sing-box) fallback above Aether's local SOCKS5 endpoint.

The GUI, Aether core, Xray core, and sing-box core have independent version lifecycles.

## Core management

Open **Settings → Core management** to manage external core versions.

For Aether, Xray, and sing-box you can:

- inspect available GitHub releases;
- install versions side-by-side;
- switch to an already installed version;
- upgrade or downgrade while disconnected;
- remove non-active managed versions;
- keep using installed versions when the release API is offline.

A newly downloaded version does not overwrite older managed versions. The selected version is stored as a small active-version pointer.

A bundled recovery core is separate from managed versions and remains available as a safety fallback.

The title bar also checks for newer stable core releases. When an update is available, an **Update core** / **Update cores** action appears. Core updates remain disabled while connected or while the GUI is elevated.

## Connection model

Proxy-only mode:

```text
Application configured for SOCKS5
        ↓
Aether SOCKS5 on loopback
        ↓
Aether tunnel
        ↓
Internet
```

System-wide mode:

```text
OS traffic
   ↓
Xray native TUN (default) or sing-box TUN (fallback)
   ↓
Aether SOCKS5 on loopback
   ↓
Aether MASQUE / WireGuard / gool tunnel
   ↓
Internet
```

Xray and sing-box are system-routing adapters. Aether remains the network core that owns MASQUE, WireGuard, gool, gateway scanning, reconnects, and the protected SOCKS endpoint.

## TUN safety

Before system routes are considered protected:

- the selected TUN executable must pass its native configuration validation command;
- Aether's exact versioned executable path is bypassed from the TUN to prevent routing loops;
- the selected TUN core is bypassed from its own interface;
- automatic route creation and default-interface detection are enabled;
- the TUN interface is dual-stack;
- Xray configures interface DNS on Windows; sing-box remains available as a compatibility fallback;
- IPv4 and IPv6 system paths are verified against the protected Aether/WARP data path without persisting public IP values;
- repeated data-plane failures tear down the broken chain instead of leaving a false Connected state.

The SOCKS listener is deliberately loopback-only.

## Process and diagnostics safety

- Aether and the selected TUN core are supervised as owned child processes.
- Only one system TUN child can be active at a time.
- stdout/stderr and PTY output are continuously drained.
- forced Aether, Xray, and sing-box termination reaps child processes.
- reconnect attempts are bounded.
- frontend live logs retain only the latest 200 entries and are rendered in a lightweight bounded viewer.
- PTY partial input is bounded.
- the structured JSONL diagnostics file is truncated on each application launch and stops writing after approximately 2 MiB in that session.
- diagnostic writes are buffered to avoid unnecessary per-line disk flushes.
- obvious credentials and the user's home-directory path are redacted before logs are written.
- public IP values used by TUN health checks are not persisted in diagnostics.

## Privileges

Proxy-only mode runs without Administrator/root privileges.

When TUN is requested, verified core binaries are prepared before elevation. The elevated instance resumes the one-shot pending connection and uses already-installed binaries. Core installation and version changes are disabled while elevated.

## Tray status

The tray icon reflects connection state at a glance:

- gray — disconnected;
- orange — connecting, reconnecting, starting/stopping TUN, or disconnecting;
- green — connected/protected;
- red — connection error.

## Updates and releases

Aether-GUI ships pinned Aether, Xray, sing-box and Wintun resources inside the desktop bundle, while newer managed core versions remain independently installable.

The current Windows candidate baseline is:

- Aether v1.4.0;
- Xray-core v26.6.1 — latest published upstream build, currently marked pre-release;
- sing-box v1.13.14;
- Wintun 0.14.1.

Xray-core v26.3.27 remains the latest upstream stable release and can be installed or selected through Core management if the newer pre-release regresses on a specific Windows host.

The title bar checks for:

- stable Aether core updates;
- stable Xray core updates;
- stable sing-box core updates;
- newer stable Aether-GUI GitHub Releases.

Core updates can be installed and activated in place while disconnected. Desktop-app updates use Tauri's signed updater from the official GitHub Release `latest.json`; app updates are prioritized before core updates and are disabled while connected or elevated. See the release guide for the one-time public-key configuration and signing secrets.

See [`docs/RELEASING.md`](docs/RELEASING.md) for the release model, signing guidance, and reproducible bundled-core baseline.

## Architecture

See:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Core Registry, engine boundaries, TUN safety, and Xray integration.
- [`docs/UPSTREAM.md`](docs/UPSTREAM.md) — how to consume future changes from `MatinSenPai/Aether-GUI` safely.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — beginner-friendly Windows build, run, test, upgrade and downgrade instructions.
- [`docs/RELEASING.md`](docs/RELEASING.md) — bundled cores, NSIS distribution, app/core update strategy and release checklist.

The central rule is:

```text
Core Registry = binary/version management
Aether adapter = protected SOCKS lifecycle and network protocols
System TUN manager = exactly one selected routing engine
Xray adapter = recommended native TUN lifecycle/config
sing-box adapter = compatibility TUN lifecycle/config
```

Do not duplicate one updater per engine and do not couple the GUI version to a fixed external-core release.

## Development on Windows

Prerequisites:

- Rust via rustup
- Node.js 24 LTS
- pnpm
- Microsoft C++ Build Tools with **Desktop development with C++**
- WebView2 Runtime when not already installed

Install dependencies:

```powershell
pnpm install
```

Prepare the pinned bundled core candidates:

```powershell
pnpm prepare:cores:windows
```

Run validation:

```powershell
pnpm typecheck
pnpm lint
pnpm check:rust
pnpm test:rust
pnpm clippy:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Run in development mode:

```powershell
pnpm tauri dev
```

Build the recommended one-file Windows setup executable, including the bundled baseline cores:

```powershell
pnpm build:windows:setup
```

Build only the raw release-mode application executable for local testing:

```powershell
pnpm build:windows:exe
```

The raw executable is not the preferred standalone distribution artifact because bundled core resources are installed alongside the application by the desktop bundle.

## Upstream projects

- Network core: [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether)
- Recommended native TUN engine: [XTLS/Xray-core](https://github.com/XTLS/Xray-core)
- Fallback TUN engine: [SagerNet/sing-box](https://github.com/SagerNet/sing-box)
- Original GUI upstream: [MatinSenPai/Aether-GUI](https://github.com/MatinSenPai/Aether-GUI)

GUI upstream changes are integrated through normal Git review/merge/cherry-pick. Aether, Xray, and sing-box release versions are managed independently by the runtime Core Registry.

## License

[GNU Affero General Public License v3.0](LICENSE)
