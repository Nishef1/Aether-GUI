# Modular runtime architecture

## Baseline

`main` is based directly on MatinSenPai/Aether-GUI v0.7.0 (`93314fcd97bf6b446d537aac9538b01bef04c7a0`). The implementation that existed before the modular reset remains preserved in `archive/pre-modular-v0.7.2`.

The official Aether v1.5.0 binary is the default and only transport engine. Protocol fixes belong in the official core, not in this GUI repository.

## Two independent extension boundaries

The runtime separates **transport engines** from **system-wide tunnel adapters**.

```text
Frontend / IPC
      |
EngineRuntime
      |-- EngineAdapter
      |     `-- Aether transport -> loopback SOCKS5
      |
      `-- SystemTunnelRuntime
            |-- sing-box TUN on desktop
            `-- Android VpnService + HEV
```

`EngineAdapter` owns a transport's process, profile, readiness, interactions and shutdown. `SystemTunnelAdapter` consumes a loopback SOCKS endpoint and owns platform routing, privilege boundaries, TUN lifecycle, health verification and traffic-interface reporting.

## Upstream boundary

The desktop Aether integration remains under `src-tauri/src/aether/`. Avoid adding Android, sing-box or platform-specific protocol patches there. The intentional composition surface is `main.rs`, `commands.rs`, `state.rs` and `engine/mod.rs`.

## Desktop sing-box adapter

The desktop adapter is isolated under `src-tauri/src/system_tunnel/sing_box/`. It is off by default and uses:

- sing-box v1.13.12, release-digest verified;
- Wintun 0.14.1 on Windows, checksum and Authenticode verified;
- `sing-box check` before launch;
- strict dual-stack TUN routing and DNS hijacking;
- direct process bypass for Aether and sing-box to prevent loops;
- end-to-end route verification before `Tunneling`;
- cancellation epochs, PID ownership and orphan cleanup.

## Shared connection telemetry

The UI receives one platform-neutral contract for:

- route-scan percentage derived from the active scan budget;
- public tunnel exit IP;
- country code rendered as a flag;
- end-to-end latency through Aether;
- upload/download totals from the active TUN dataplane;
- authoritative connection duration from `connected_at_ms`.

Telemetry is supplementary and cannot mark an unverified connection as successful.

## Android adapter

Android is isolated under:

```text
src-tauri/src/android.rs
src-tauri/plugins/aether-vpn/
scripts/prepare-android-native.sh
```

It uses the official Aether v1.5.0 ARM64 release and HEV 2.14.4 behind a stable local JNI wrapper. The Android adapter owns:

- `VpnService` permission and foreground lifecycle;
- official Aether process startup with app-managed identity files;
- MASQUE, WireGuard and gool plus all GUI-facing Aether 1.5 controls;
- Cloudflare Zero Trust email, service-token and pre-obtained-token authentication;
- interactive one-time-code delivery without exposing the code in logs;
- DNS, block/direct rules and route-file forwarding;
- peer overrides, ECH, validation/reconnect, fragmentation, keepalive, TLS groups and performance profiles;
- configurable dual-stack MTU shared by `VpnService` and HEV;
- SOCKS readiness and real egress verification;
- HEV TUN-to-SOCKS startup and traffic counters;
- cancellation-safe cleanup during repeated connect/disconnect;
- status and telemetry reconciliation independent of WebView lifetime.

Desktop sing-box, Wintun and elevation code do not compile into Android. Android's system-tunnel selection maps to the native VpnService adapter.

### Android privacy and efficiency policy

- Live logs are off by default.
- When enabled, logs are bounded and process-memory only.
- Hiding the WebView disables native log collection and clears visible logs.
- Neither Aether output nor HEV diagnostics are written to storage.
- Zero Trust credentials and one-time codes are never persisted or placed in command-line arguments.
- Status and telemetry polling stop while the WebView is hidden and use slower intervals after connection.
- Continuous decorative motion is disabled on Android; the VPN service continues without requiring the WebView to render.

Necessary identity/configuration files are still persisted because the core requires them to retain provisioned device identity. They are not diagnostic logs.

## Build and release boundary

`.github/workflows/build.yml` is the single build workflow. It creates artifacts for:

- Windows x86_64;
- Linux x86_64;
- macOS arm64;
- macOS x86_64;
- Android arm64-v8a.

The workflow does not create releases or react to tags. Publishing a release is a separate explicit action after artifacts and device tests are accepted.

## Upgrade procedure

1. Fetch the latest Matin GUI and official Aether versions.
2. Merge upstream-owned desktop files before custom platform modules.
3. Compare the official CLI surface with both desktop and Android profile contracts.
4. Keep every sidecar and native dependency version-pinned with checksum verification and license material.
5. Run frontend, Rust, Kotlin/JVM, native and bundle builds.
6. Test Android lifecycle, battery behavior and real traffic separately from protocol discovery.
7. Publish only after the generated artifacts are visible and tested.

Never carry protocol fixes in this GUI repository when they belong in the official core.
