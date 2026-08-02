# Modular runtime architecture

## Baseline

`main` is based directly on MatinSenPai/Aether-GUI v0.7.0 (`93314fcd97bf6b446d537aac9538b01bef04c7a0`). The implementation that existed before the reset is preserved in `archive/pre-modular-v0.7.2`.

The official Aether binary is the default and only transport engine. Protocol fixes belong in the official core, not in this GUI repository.

## Two independent extension boundaries

The runtime deliberately separates **transport engines** from **system-wide tunnel adapters**.

```text
Frontend / IPC
      |
EngineRuntime
      |-- EngineAdapter
      |     `-- Aether transport -> loopback SOCKS5
      |
      `-- SystemTunnelRuntime
            `-- SystemTunnelAdapter
                  `-- sing-box TUN -> Aether SOCKS5
```

### Transport engines

`src-tauri/src/engine/EngineAdapter` owns transport-specific process startup, profiles, readiness, interactions and shutdown. Aether is wrapped by an adapter without changing `src-tauri/src/aether/`.

### System-wide tunnels

`src-tauri/src/system_tunnel/SystemTunnelAdapter` consumes a transport's loopback SOCKS endpoint and owns operating-system routing, privilege elevation, TUN lifecycle, health verification and traffic-interface reporting.

sing-box is intentionally implemented here rather than as another transport engine. It does not replace MASQUE, WireGuard or gool; it only routes desktop application traffic into Aether's existing SOCKS endpoint.

## Upstream boundary

The upstream Aether integration remains under `src-tauri/src/aether/`. Avoid editing it for Android, sing-box or future sidecars. Upstream updates should normally replace or merge that directory without knowing about custom platform modules.

The small intentional integration surface is:

1. `main.rs` registers the runtime, watchers and IPC commands.
2. `commands.rs` preserves Matin's Aether-shaped IPC and exposes extension APIs.
3. `state.rs` exposes the shared engine-neutral connection state.
4. `engine/mod.rs` composes transports with optional system tunnels.

## sing-box desktop adapter

The desktop module lives under:

```text
src-tauri/src/system_tunnel/sing_box/
  config.rs
  mod.rs
  process.rs
  status.rs
```

Properties:

- pinned sing-box release rather than an unbounded `latest` download;
- release asset SHA-256 verification;
- Wintun archive checksum and Authenticode verification on Windows;
- config validation with `sing-box check` before startup;
- loop prevention by routing Aether and sing-box processes directly;
- dual-stack TUN with strict routing and DNS hijacking;
- end-to-end data-path verification before reporting `Tunneling`;
- PID ownership checks and orphan cleanup;
- cancellation epochs so a stopped connection cannot publish a stale startup result;
- traffic counters sourced from the adapter-owned TUN interface.

The adapter is off by default. Enabling it is a persisted launch setting and may require administrator approval.

## Telemetry contract

Telemetry is supplementary and cannot decide whether the connection is successful. It reports:

- public tunnel exit IP;
- country code used by the frontend to render a flag;
- end-to-end latency through Aether's SOCKS path;
- cumulative upload and download bytes from the active TUN interface;
- sample timestamp.

The connection duration is derived from the authoritative `connected_at_ms` carried by the shared state machine. Route-scan percentage remains derived from Aether's own logged scan budget and is capped below 100 until backend readiness is confirmed.

## Android boundary

Android belongs at the platform boundary, not inside Aether or the desktop sing-box adapter. The Android implementation owns `VpnService`, permission flow, foreground lifecycle, socket protection and TUN-to-SOCKS plumbing while exposing the same connection and telemetry contracts.

```text
src-tauri/plugins/aether-vpn/   # Android native service/plugin
src-tauri/src/platform/android/ # Rust/Tauri command bridge
src-tauri/src/engine/           # shared transport abstraction
```

Desktop sing-box elevation and Wintun code must not compile into Android. Android uses its own VpnService dataplane.

## Upgrade procedure

1. Fetch the latest Matin upstream commit.
2. Compare it with the recorded upstream baseline.
3. Merge upstream-owned files first, especially `src-tauri/src/aether/` and frontend components.
4. Reapply or resolve only the small runtime/bootstrap integration surface.
5. Keep sidecars version-pinned and validate their release metadata and licenses.
6. Run Rust tests, frontend checks and native builds.
7. Test Android lifecycle separately from core protocol behavior.

Never carry protocol fixes in this GUI repository when they belong in the official core. Submit or consume them upstream instead.
