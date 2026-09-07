# Modular runtime architecture

## Current baseline

Aether-GUI is maintained as an independent client. The MatinSenPai/Aether-GUI history remains useful as project lineage/reference, but it is no longer the operational upstream for current development.

The transport upstream is **CluvexStudio/Aether**. `main` pins the official **Aether v1.9.0** release at commit `311b573352bb67e494895ff67d20b002d075116a`. Runtime versions are centralized in `scripts/runtime-versions.json`.

Protocol fixes belong in the official core. The GUI may adapt CLI/env integration, platform lifecycle and system-tunnel composition, but it must not grow private MASQUE/WireGuard/gool protocol forks.

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

`EngineAdapter` owns the transport process, connection profile, readiness, interactive actions and shutdown. `SystemTunnelAdapter` consumes a loopback SOCKS endpoint and owns OS routing, elevation, TUN lifecycle, health verification and traffic-interface reporting.

The boundaries are intentionally independent: updating sing-box must not change the Aether protocol integration, and updating Aether must not require Android/desktop TUN code to be folded into the transport core.

## Aether 1.9 profile contract

The frontend, desktop Rust adapter and Android Rust/Kotlin bridge share the same user-facing Aether 1.9 concepts:

- MASQUE, WireGuard and gool;
- Turbo/Balanced/Thorough/Stealth/Ironclad discovery;
- IPv4/IPv6/dual-stack scanning;
- HTTP/3 vs HTTP/2 MASQUE carrier;
- protocol-specific noize profiles;
- optional local HTTP CONNECT proxy;
- outbound upstream proxy chaining;
- manual peer overrides and Aether 1.9 WARP-in-WARP outer/inner endpoints;
- WARP-in-WARP two-hop scanning;
- ECH and H2 ClientHello fragmentation;
- validation/reconnect and WireGuard keepalive/profile-retry controls;
- TLS/performance expert controls;
- Zero Trust authentication;
- DNS and route rules;
- route sniffing behind TUN;
- rejected-identity reprovisioning.

Transport-specific values are scoped at the native boundary. Hidden stale WARP-in-WARP fields cannot leak into MASQUE/WireGuard launches, and stale MASQUE fields cannot change WireGuard/gool behavior. Credential-bearing upstream URLs and Zero Trust secrets are supplied through environment/process input where appropriate and are scrubbed before profiles are persisted.

## Desktop Aether adapter

Desktop Aether integration lives under `src-tauri/src/aether/`.

The GUI launches the pinned official binary through a PTY. Normal Aether 1.9 launches are fully specified by CLI flags/environment variables; interactive menu parsing remains compatibility fallback only. Zero Trust email-code prompts are promoted to independent GUI interaction state and do not depend on live diagnostic logging being enabled.

The desktop transport reports Connected only after the configured loopback SOCKS endpoint is actually live. Unexpected process loss enters bounded reconnect behavior rather than silently leaving stale UI state.

## Desktop system tunnel

The desktop system-tunnel adapter is isolated under `src-tauri/src/system_tunnel/sing_box/` and uses:

- sing-box v1.13.12 from the central runtime manifest;
- Wintun on Windows where required;
- configuration validation before launch;
- strict dual-stack TUN routing and DNS hijacking;
- direct process bypass for Aether/sing-box to avoid routing loops;
- end-to-end route verification before `Tunneling`;
- cancellation epochs, PID ownership and orphan cleanup;
- Windows process-tree cleanup for elevated/controller descendants.

**New installations default to the system-wide sing-box tunnel.** An explicit user choice to turn it off is persisted and respected. This default lives in the native runtime source of truth, not browser/WebView storage, so a fast first Connect cannot race React initialization.

## Android adapter

Android is isolated under:

```text
src-tauri/src/android.rs
src-tauri/plugins/aether-vpn/
scripts/prepare-android-native.sh
```

It uses the official Aether v1.9.0 ARM64 release plus HEV 2.14.4 behind a stable local JNI wrapper. Android owns:

- `VpnService` permission and foreground lifecycle;
- verified official Aether ARM64 process startup;
- MASQUE, WireGuard and gool feature mapping;
- Zero Trust email/service-token/access-token auth and one-time-code delivery;
- configurable DNS/routing rules;
- MTU shared by `VpnService` and HEV;
- SOCKS readiness plus real reusable end-to-end egress verification;
- HEV TUN-to-SOCKS startup and traffic counters;
- cancellation-safe cleanup across repeated connect/disconnect;
- telemetry/status reconciliation independent of WebView rendering.

Android intentionally sanitizes the local Aether bind address to loopback. The UI therefore does not offer LAN SOCKS exposure on Android. Full-device `VpnService` tunnelling is the normal Android product path; proxy-only mode is not exposed as a normal user choice.

### Android privacy and efficiency

- Live logs are off by default, bounded and process-memory only.
- Hiding the WebView disables native log collection and clears visible diagnostics.
- Necessary Aether identity/config files may persist; diagnostic output does not.
- Zero Trust credentials, one-time codes and credential-bearing upstream URLs are not persisted in the successful profile.
- Status/telemetry polling pauses while hidden and slows after connection.
- Decorative continuous motion is disabled/reduced on Android while the native VPN service continues independently.
- Android safe-area and IME-sensitive UI customisation is applied deterministically rather than relying on one-off generated-project edits.

## Shared connection telemetry

The UI receives one platform-neutral contract for:

- public tunnel exit IP;
- country code;
- end-to-end latency;
- upload/download totals from the active dataplane;
- authoritative connection duration from `connected_at_ms`;
- route-search timing/progress where a scan budget is available.

Telemetry is supplementary. It cannot convert an unverified transport/system tunnel into a successful state.

## Build boundary

`.github/workflows/build.yml` is **manual-only** (`workflow_dispatch`). It targets:

- Windows x86_64;
- Linux x86_64;
- macOS arm64;
- macOS x86_64;
- Android arm64-v8a.

The workflow builds/tests artifacts only. It does not react to pushes/tags and does not create, update or delete GitHub Releases. Publishing is a separate explicit action after runtime/device acceptance.

## Upgrade procedure

1. Check the latest **official CluvexStudio/Aether** release and changelog.
2. Update only `scripts/runtime-versions.json` for the intended core pin, then reconcile asset/checksum expectations.
3. Compare the official Aether CLI/env surface against both desktop and Android profile contracts.
4. Keep transport-specific arguments scoped so stale values cannot cross protocol boundaries.
5. Keep every sidecar/native dependency pinned and verification fail-closed.
6. Run source checks and platform builds manually; do not enable automatic CI as a shortcut.
7. Validate data-plane behavior on real Windows and Android devices, including connect/disconnect/reconnect, background lifecycle, MASQUE H2/H3, WireGuard, gool, DNS/routing and system TUN.
8. Publish only after accepted artifacts are tested.

## Public-release naming check

The transport upstream has its own trademark policy. Before a new public release using the Aether name/logo, review `CluvexStudio/Aether/TRADEMARK.md` and obtain any required permission or rebrand the client. This is a release/compliance boundary, not transport runtime logic.
