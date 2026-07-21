# Aether-GUI

[![License: AGPL v3](https://img.shields.io/github/license/Nishef1/Aether-GUI)](LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)

**English** · [فارسی](README_fa.md)

Aether-GUI is a lightweight desktop control plane around the real [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) core. It can optionally place a supervised [sing-box](https://github.com/SagerNet/sing-box) TUN layer above Aether's local SOCKS5 endpoint for system-wide routing.

The GUI, Aether core, and sing-box core have independent version lifecycles.

## Core management

Open **Settings → Core management** to manage external core versions.

For both Aether and sing-box you can:

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
sing-box TUN
   ↓
Aether SOCKS5 on loopback
   ↓
Aether tunnel
   ↓
Internet
```

## TUN safety

Before system routes are considered protected:

- the selected sing-box executable must pass `sing-box check` against the generated configuration;
- Aether's exact versioned executable path is bypassed from the TUN to prevent routing loops;
- sing-box itself is bypassed from its own TUN;
- automatic route creation and default-interface detection are enabled;
- strict routing is enabled;
- the TUN interface is dual-stack;
- DNS on port 53 is hijacked into sing-box's DNS module and resolved through the protected Aether path;
- IPv4 and IPv6 system paths are verified against the protected Aether/WARP data path without persisting public IP values;
- repeated data-plane failures tear down the broken chain instead of leaving a false Connected state.

The SOCKS listener is deliberately loopback-only.

## Process and diagnostics safety

- Aether and sing-box processes are supervised as owned child processes.
- No global kill-by-image-name behavior is used.
- stdout/stderr and PTY output are continuously drained.
- forced Aether and sing-box termination reaps child processes.
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

Aether-GUI ships a tested baseline Aether core and sing-box/Wintun resources inside the desktop bundle, while newer managed core versions remain independently installable.

The title bar checks for:

- stable Aether core updates;
- stable sing-box core updates;
- newer stable Aether-GUI GitHub Releases.

Core updates can be installed and activated in place while disconnected. A desktop-app update currently opens the exact official GitHub Release page. Seamless in-app installation is intentionally reserved for Tauri's signed updater flow rather than an unsigned custom executable download.

See [`docs/RELEASING.md`](docs/RELEASING.md) for the release model, signing guidance, and reproducible bundled-core baseline.

## Architecture

See:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Core Registry, engine boundaries, TUN safety, future Xray integration.
- [`docs/UPSTREAM.md`](docs/UPSTREAM.md) — how to consume future changes from `MatinSenPai/Aether-GUI` safely.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — beginner-friendly Windows build, run, test, upgrade and downgrade instructions.
- [`docs/RELEASING.md`](docs/RELEASING.md) — bundled cores, NSIS distribution, app/core update strategy and release checklist.

The central rule is:

```text
Core Registry = binary/version management
Aether adapter = Aether lifecycle and SOCKS connection
sing-box adapter = system-wide TUN lifecycle
future Xray adapter = Xray-specific lifecycle/config
```

Do not duplicate one updater per engine and do not couple the GUI version to a fixed Aether release.

## Development on Windows

Prerequisites:

- Rust via rustup
- Node.js
- pnpm
- Microsoft C++ Build Tools with **Desktop development with C++**
- WebView2 Runtime when not already installed

Install dependencies:

```powershell
pnpm install
```

Prepare the tested bundled baseline cores:

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
- Original GUI upstream: [MatinSenPai/Aether-GUI](https://github.com/MatinSenPai/Aether-GUI)
- TUN engine: [SagerNet/sing-box](https://github.com/SagerNet/sing-box)

GUI upstream changes are integrated through normal Git review/merge/cherry-pick. Aether and sing-box release versions are managed independently by the runtime Core Registry.

## License

[GNU Affero General Public License v3.0](LICENSE)
