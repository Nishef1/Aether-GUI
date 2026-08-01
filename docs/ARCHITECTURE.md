# Modular engine architecture

## Baseline

`main` is intentionally based directly on MatinSenPai/Aether-GUI v0.7.0 (`93314fcd97bf6b446d537aac9538b01bef04c7a0`). The pre-reset implementation is preserved in `archive/pre-modular-v0.7.2`.

The official Aether binary remains the default and only engine for now. No tunnelling logic is copied into the GUI.

## Upstream boundary

The upstream Aether integration remains under `src-tauri/src/aether/`. Avoid editing it for platform or secondary-engine features. Upstream updates should normally replace or merge this directory without knowing about Android, sing-box, or another sidecar.

Custom integration code belongs behind `src-tauri/src/engine/EngineAdapter`. The runtime registry owns engine selection, lifecycle, profile serialization and engine-specific interactions.

The only intended upstream touchpoints are:

1. `main.rs` registers the runtime and its IPC commands.
2. `commands.rs` preserves Matin's existing Aether IPC while exposing an engine-neutral API.
3. `state.rs` stores the engine-neutral runtime and shared connection state.

Keeping the patch surface this small is the main upgrade strategy.

## Adapter contract

Each engine adapter owns:

- process or native-service startup and shutdown;
- profile validation and persistence;
- readiness detection and connection state;
- engine-specific interactive input;
- orphan cleanup;
- capability metadata.

Adapters must not call each other or modify another engine's files. Shared UI and Android code select an adapter through the registry.

## Future sing-box module

A sing-box integration should be added as a separate adapter and directory, for example:

```text
src-tauri/src/engine/sing_box/
  mod.rs
  profile.rs
  process.rs
  status.rs
```

It should register itself in `EngineRuntime::default()` and communicate through the generic IPC commands. It must not patch `src-tauri/src/aether/`.

## Android module

Android belongs at the platform boundary, not in the Aether core. The Android implementation should own `VpnService`, permission flow, foreground lifecycle, socket protection and TUN-to-SOCKS plumbing. It should start the selected engine through the same registry contract.

Suggested isolation:

```text
src-tauri/plugins/aether-vpn/   # Android platform service
src-tauri/src/platform/android/ # Rust/Tauri bridge
src-tauri/src/engine/           # Engine adapters
```

## Upgrade procedure

1. Fetch the latest Matin upstream commit.
2. Compare upstream against the current upstream baseline.
3. Merge or reset the upstream-owned files first.
4. Reapply only the small runtime/bootstrap patch if needed.
5. Run Rust tests, frontend checks and platform builds.
6. Test Android lifecycle separately from core protocol behavior.

Never carry protocol fixes in this GUI repository when they belong in the official core. Submit or consume them upstream instead.
