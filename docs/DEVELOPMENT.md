# Development guide

## Windows prerequisites

Install these once:

1. Rust using rustup.
2. Node.js.
3. pnpm.
4. Microsoft C++ Build Tools with **Desktop development with C++** selected.
5. Microsoft Edge WebView2 Runtime if it is not already present.

Verify the tools in PowerShell:

```powershell
rustc --version
cargo --version
node --version
pnpm --version
```

## Clone and enter the repository

```powershell
git clone https://github.com/Nishef1/Aether-GUI.git
cd Aether-GUI
```

For an existing clone:

```powershell
git pull
```

## Install JavaScript dependencies

```powershell
pnpm install
```

## Prepare bundled recovery cores

This is recommended before a local release build so the application has an offline fallback:

```powershell
pnpm prepare:cores:windows
```

Runtime-managed versions are separate from these bundled fallback binaries and are installed from the **Core management** section in the application.

## Validate source code

Run these from the repository root:

```powershell
pnpm typecheck
pnpm lint
pnpm check:rust
pnpm test:rust
pnpm clippy:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Optional Rust dependency audit:

```powershell
cargo install cargo-audit
cargo audit --file src-tauri/Cargo.lock
```

## Run the application in development mode

```powershell
pnpm tauri dev
```

The first Rust build downloads and compiles Rust crates, so it is much slower than later incremental builds.

## Test proxy-only mode

1. Leave **System-wide TUN** disabled.
2. Press **Connect**.
3. Wait for the Aether SOCKS endpoint to become ready.
4. Test an application explicitly configured to use the displayed loopback SOCKS endpoint.
5. Disconnect.
6. Repeat connect/disconnect several times and inspect diagnostics for orphan-process or unexpected-recovery messages.

## Test system-wide TUN mode

1. Start Aether-GUI normally, not with **Run as administrator**.
2. Open **Advanced**.
3. Enable **System-wide TUN**.
4. Press **Connect**.
5. The normal process prepares verified Aether and sing-box cores first.
6. Accept the UAC prompt.
7. The elevated instance resumes the pending connection.
8. Wait until the UI reports system-wide protection only after the data-path health check succeeds.
9. Test normal browsing and DNS resolution.
10. Disconnect.

Also test cancelling/disconnecting while the TUN is still starting.

## Test core upgrade and downgrade

While disconnected:

1. Open **Advanced → Core management**.
2. Press refresh for Aether or sing-box.
3. Choose a release.
4. Press **Install** when it is not installed yet.
5. To move to an already installed release, select it and press **Use**.
6. Reconnect and verify behavior.
7. Disconnect before switching again.

Installed versions are stored side-by-side. Switching does not overwrite other installed versions.

A sing-box version is not allowed to change system routes until `sing-box check` accepts the current generated TUN configuration.

## Diagnostics

Persistent logs are stored under the application's data directory in:

```text
logs/aether-gui.jsonl
logs/aether-gui.jsonl.1
```

Credential-looking lines and the user's home-directory path are redacted before persistent storage. TUN public IP values used for in-memory egress comparison are not written to the health-check log.

## Build a release

```powershell
pnpm tauri build
```

Tauri bundle output is created under:

```text
src-tauri/target/release/bundle/
```

Do not run a release build until typecheck, Rust tests, Clippy, formatting, and the manual proxy/TUN checks are clean.
