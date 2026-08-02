# Modular runtime architecture

## Baseline

`main` is based directly on MatinSenPai/Aether-GUI v0.7.0 (`93314fcd97bf6b446d537aac9538b01bef04c7a0`). The implementation that existed before the reset is preserved in `archive/pre-modular-v0.7.2`.

The official Aether binary is the default and only transport engine. Protocol fixes belong in the official core, not in this GUI repository.

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

The upstream Aether integration remains under `src-tauri/src/aether/`. Avoid editing it for Android, sing-box or future sidecars. The small intentional integration surface is `main.rs`, `commands.rs`, `state.rs` and `engine/mod.rs`.

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

It uses the official Aether v1.5.0 ARM64 release and HEV 2.14.4 behind a stable local JNI wrapper. The platform module owns:

- `VpnService` permission and foreground lifecycle;
- Aether process startup and bounded native logs;
- SOCKS readiness and real egress verification;
- HEV TUN-to-SOCKS startup and traffic counters;
- cancellation-safe cleanup during repeated connect/disconnect;
- service-state and telemetry reconciliation independent of WebView visibility.

Desktop sing-box, Wintun and elevation code do not compile into Android. Android's system-tunnel selection maps to the native VpnService adapter instead.

Current Android boundary: consumer Aether profiles, MASQUE/WireGuard/gool, DNS selection and native system tunneling are wired. Zero Trust enrolment and Aether route files/lists are rejected explicitly until the mobile credential and per-app routing contracts are implemented; they are never silently ignored.

## Upgrade procedure

1. Fetch the latest Matin upstream commit.
2. Merge upstream-owned files before custom platform modules.
3. Keep `src-tauri/src/aether/` aligned with upstream.
4. Keep every sidecar and native dependency version-pinned with license material.
5. Run Rust, frontend, Kotlin/JVM and native build validation.
6. Test Android lifecycle separately from transport protocol behavior.

Never carry protocol fixes in this GUI repository when they belong in the official core.
