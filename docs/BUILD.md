# Build and validation pipeline

Aether-GUI keeps one GitHub Actions workflow at `.github/workflows/build.yml`, but it is intentionally **manual-only**.

```yaml
on:
  workflow_dispatch:
```

Do not add a push/tag trigger or automatic release publishing unless the project policy is explicitly changed again.

## Runtime source of truth

Pinned runtime versions live in `scripts/runtime-versions.json`:

- Aether v1.9.0 at `311b573352bb67e494895ff67d20b002d075116a`;
- sing-box v1.13.12;
- HEV 2.14.4.

`npm run verify:runtimes` checks that the platform preparation scripts consume that manifest instead of carrying independent version literals.

Official Aether release assets are checksum/digest verified before use. Desktop Linux uses the official musl build so the bundled transport is not tied to a particular distribution glibc.

## Target matrix

The manual workflow covers:

- Windows x86_64
- Linux x86_64
- macOS arm64
- macOS x86_64
- Debian 12 package smoke verification
- Arch Linux native package verification
- Android arm64-v8a

The workflow uploads build artifacts. It does **not** create/update/delete GitHub Releases, tags, old artifacts or workflow runs.

## Local source validation

From a clean checkout:

```bash
npm ci
npm run verify:runtimes
npm run typecheck
python3 scripts/tests/test_android_feature_parity.py
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

The Python parity suite is a source-contract test for the Aether 1.9 desktop/Android mapping, secret handling, mobile-first shell, system-tunnel default and manual-only build policy. It is not a substitute for real runtime testing.

## Desktop development/build

Prepare verified runtimes:

```bash
npm run prepare:aether
npm run prepare:sidecars
```

Development:

```bash
npm run tauri -- dev
```

Release bundle on the current platform:

```bash
npm run tauri -- build
```

Platform prerequisites follow Tauri v2. Linux additionally needs the WebKitGTK/GTK/AppIndicator/polkit packages declared by the project packaging config.

### Desktop acceptance checks

A desktop candidate is not accepted merely because it compiles. Manually verify:

1. Core reports the pinned Aether version.
2. MASQUE HTTP/3 and HTTP/2 both reach real egress where the network supports them.
3. WireGuard and gool establish real data-plane traffic, not only a handshake/listening SOCKS port.
4. Default sing-box system TUN reaches `Tunneling` and changes real application egress.
5. Explicitly disabling system TUN remains persisted.
6. Connect/disconnect/reconnect can be repeated without orphan Aether/sing-box/Wintun processes.
7. DNS/direct/block rules behave as configured.
8. Zero Trust email OTP appears even when Live Logs is disabled.
9. Credential-bearing upstream proxy values are absent from saved profiles/process argv.
10. Windows installer/uninstaller and Linux/macOS bundles carry the intended sidecars/resources.

## Android ARM64

Required toolchain:

- JDK 17
- Android SDK 36
- Android NDK `28.2.13676358`
- Bash
- Rust target `aarch64-linux-android`

Initialize the generated Tauri Android project and apply deterministic branding/customisation:

```bash
npm run android:init
```

Prepare the verified native runtime:

```bash
npm run prepare:android-native
```

Build the ARM64 package:

```bash
npm run android:build
```

The native preparation script downloads the official pinned Aether Android ARM64 release, verifies its published digest, builds pinned HEV, builds the local JNI bridge and records a `.native-versions.json` stamp.

`tauri android init` can regenerate the Android project. Do not depend on manual edits under generated resources/Gradle files unless a deterministic project script reapplies them after init.

### Android acceptance checks

Use a real ARM64 device. The current development priority is Samsung-class Android hardware, not an emulator-only pass.

1. Clean install and upgrade install both succeed.
2. VPN permission is requested once and cancellation is handled cleanly.
3. Android shows the mobile shell without desktop title/minimize/close chrome.
4. Content respects top/bottom safe areas and remains usable with the keyboard open.
5. All normal touch controls have mobile-sized hit targets.
6. The local SOCKS listener remains loopback-only.
7. MASQUE H3/H2, WireGuard and gool are each tested independently.
8. SOCKS egress is proven before the device TUN is considered protected.
9. DNS and routing presets/custom rules produce the expected traffic path.
10. Repeated connect/disconnect does not leave a stale `VpnService`, Aether process, HEV bridge or TUN descriptor.
11. Background/screen-off operation retains the VPN while WebView polling/log collection is reduced.
12. Returning to foreground reconciles status/traffic correctly.
13. Live Logs remain opt-in and are cleared/disabled when hidden.
14. Exit IP, DNS behavior and known WebRTC-leak scenarios are checked from applications that matter to the release.
15. Signed release APK contains only the intended ARM64 native libraries and verifies with the permanent signer.

## Manual GitHub workflow

After local/runtime acceptance, the existing workflow may be started explicitly from GitHub Actions when cross-platform artifacts are needed. Starting it is a conscious release-engineering action; normal pushes must not start it.

The workflow performs source checks, platform builds, package smoke tests and artifact upload. Its result is still not sufficient to publish a release without device/runtime acceptance.

## Versioning

Do not bump the application version merely to mark source progress. For a real release, update the package/Tauri/package-manager metadata together, regenerate any lockfile fields that depend on the app version, then rebuild and validate every published artifact. Tauri derives Android `versionCode` from the semantic app version when an explicit value is not provided; keep that derivation monotonic for upgrades.

The existing published `v0.7.2` artifacts predate the Aether 1.9/mobile-first work. A future release should receive a new version after this branch passes the manual acceptance matrix; do not overwrite `v0.7.2` in place.

## Public-release compliance

Before distributing a new build using the Aether name/logo, review the current upstream `CluvexStudio/Aether/TRADEMARK.md` and resolve any required permission/rebranding decision. This check belongs before release publication, not in automatic build logic.
