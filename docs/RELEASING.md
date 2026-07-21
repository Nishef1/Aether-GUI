# Releasing Aether-GUI

This document defines the release contract for the desktop application and its independently versioned network cores.

## Distribution model

Aether-GUI ships three layers that update independently:

1. **Desktop application** — the Tauri GUI and control plane.
2. **Aether core** — the censorship-circumvention tunnel exposed to the GUI as a local SOCKS5 endpoint.
3. **sing-box core** — the system-wide TUN adapter. On Windows the baseline bundle also includes Wintun.

The Windows release artifact intended for end users is the **NSIS setup executable**, not the raw `aether-gui.exe` from Cargo's target directory.

The setup executable is one file for the user to download, but it installs the GUI together with the tested baseline resources from `src-tauri/binaries/`. The application can therefore connect on first launch without downloading a core. Later core releases remain optional, independently downloadable updates managed by the Core Registry.

## Tested bundled baseline

The reproducible baseline currently bundled by the build scripts is:

- Aether: `v1.3.0`
- sing-box: `v1.13.14`
- Wintun: fetched and verified by the sing-box preparation script when required

Do not change these pins merely because a newer core release exists. Update a bundled baseline only after the GUI/TUN compatibility path has been tested with that exact version.

Managed core updates installed after release live under the application's data directory, while the bundled resources remain the recovery fallback. The Core Registry selects the managed version when one is active and falls back to the bundled baseline when necessary.

## Windows build commands

Install dependencies first:

```powershell
pnpm install
```

Run the normal validation gates:

```powershell
pnpm typecheck
pnpm lint
pnpm check:rust
pnpm test:rust
pnpm clippy:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

### Recommended end-user release

Build a current-user NSIS setup executable containing the pinned baseline cores:

```powershell
pnpm build:windows:setup
```

The installer is emitted under Tauri's release bundle directory, normally:

```text
src-tauri/target/release/bundle/nsis/
```

The exact filename is generated from the product name, version, and target architecture.

### Raw release executable for local testing

```powershell
pnpm build:windows:exe
```

The raw binary is normally:

```text
src-tauri/target/release/aether-gui.exe
```

This is useful for local release-mode testing. It is **not** the preferred portable distribution artifact because Tauri resources such as bundled cores are external resources rather than bytes embedded inside that executable.

## Core update behavior

The title bar checks stable releases for Aether and sing-box after startup and periodically while the application is running.

When a newer stable core exists:

- An `Update core` or `Update cores` action appears in the title bar.
- Core updates are allowed only while disconnected.
- Downloads are disabled while the GUI itself is elevated.
- The existing verified installer helpers download the requested exact version and verify its integrity.
- The downloaded executable is stored as an immutable versioned core.
- The Core Registry switches the active-version pointer to the new version.
- The tested bundled core remains available as the recovery fallback.

Manual install, downgrade, and version selection remain available in Core Management.

## Desktop application update behavior

The application checks the latest stable GitHub Release for `Nishef1/Aether-GUI`. When a newer GUI version exists, the title bar shows `Update app` (or `Updates` when core updates also exist).

The current safe behavior opens the exact release page under the official repository. It does **not** silently download or execute an unsigned installer.

For seamless in-app installation, use Tauri's official updater with signed update artifacts. Tauri requires updater signatures; do not bypass or replace this verification with a custom unsigned self-updater.

### One-time signing-key setup for seamless self-update

Generate the updater key pair on a trusted machine:

```powershell
pnpm tauri signer generate -- -w "$HOME/.tauri/aether-gui.key"
```

Rules:

- Commit only the **public key** if/when it is added to updater configuration.
- Never commit the private key or its password.
- Store the private key and password in the release machine's secret store or CI secrets.
- Back up the private key securely. Existing installations rely on the corresponding public key to authenticate future updates.

After the key is created, the intended updater endpoint for GitHub Releases is:

```text
https://github.com/Nishef1/Aether-GUI/releases/latest/download/latest.json
```

At that point the release build should generate signed updater artifacts and `latest.json`, and the existing title-bar update UI can be connected to Tauri's signed download/install flow instead of opening the release page.

## Versioning an app release

Keep the desktop version synchronized in:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Use a semantic Git tag such as:

```text
v0.5.1
```

The title-bar app update check compares the installed package version against the latest stable GitHub Release tag.

## Release checklist

1. Verify the bundled core pins are the exact versions tested with the GUI.
2. Run all TypeScript, ESLint, Rust check, Rust test, Clippy, and rustfmt gates.
3. Test `Proxy`, `Tunnel`, and `Both` in a release build.
4. Test UAC elevation and confirm no extra console window appears.
5. Test connect/disconnect/reconnect and tray state colors.
6. Test bundled first-run behavior without relying on a managed core in AppData.
7. Test core update and downgrade while disconnected.
8. Build the NSIS setup with `pnpm build:windows:setup`.
9. Install the setup on a clean Windows user profile or test VM before publishing.
10. Publish the setup executable in a stable GitHub Release.
11. When signed self-update is enabled, also publish the signed updater artifacts and `latest.json`.
