# Aether-GUI Architecture

## Product boundary

Aether-GUI is a desktop control plane. It does not reimplement Aether's censorship-circumvention protocols.

The current data path is:

```text
Applications / OS traffic
        |
        | optional system-wide TUN
        v
Xray native TUN (default) or sing-box TUN (fallback)
        |
        v
Aether local SOCKS5 (loopback only)
        |
        v
Aether MASQUE / WireGuard / gool tunnel
```

Aether owns protocol selection, gateway scanning, reconnects and the protected SOCKS endpoint. Xray and sing-box are system-routing adapters only.

The GUI release lifecycle is independent from all external-core release lifecycles.

## Core Registry

`src-tauri/src/core_manager.rs` is the single source of truth for external core version management.

Responsibilities:

- discover GitHub releases;
- track installed versions;
- install versions side-by-side;
- choose one active version per core;
- allow upgrade and downgrade while disconnected;
- keep installed versions usable offline;
- refuse core installation while the GUI is elevated;
- provide bundled recovery binaries when no managed binary is usable;
- quarantine an Aether release that proves incompatible during early startup.

Managed core layout:

```text
app-data/
  cores/
    aether/
      active-version.txt
      rejected-version.txt
      aether-vX.Y.Z[.exe]
    xray/
      active-version.txt
      xray-vX.Y.Z[.exe]
      wintun.dll                  # Windows
    singbox/
      active-version.txt
      sing-box-vX.Y.Z[.exe]
      wintun.dll                  # Windows
  tun/
    xray-config.json
    singbox-config.json
    system-tun.pid
  logs/
    aether-gui.jsonl
    aether-gui.jsonl.1
```

Versioned binaries are never overwritten by switching versions. Selecting a version only changes the small active-version pointer while disconnected.

Bundled binaries are safety recovery paths, not legacy API compatibility layers.

## Engine adapters

Binary/version management and network-engine behavior are deliberately separate.

- `src-tauri/src/aether/` owns Aether launch arguments, capability discovery, PTY interaction, connection supervision and SOCKS readiness.
- `src-tauri/src/xray/` owns Xray native-TUN configuration and process launch primitives.
- `src-tauri/src/singbox/config.rs` and `process.rs` own sing-box-specific configuration and process launch primitives.
- `src-tauri/src/singbox/mod.rs` is the single system-TUN lifecycle owner. It selects exactly one adapter, validates it, supervises it, verifies the system path, and cleans up its PID.
- `src-tauri/src/core_manager.rs` owns versions and binary selection only.

The compatibility name `SingboxManager` remains internal while the module owns both engines; it must not be interpreted as two simultaneous TUN supervisors.

```text
Core Registry
  - Aether versions
  - Xray versions
  - sing-box versions

Aether adapter
  - protected loopback SOCKS
  - MASQUE / WireGuard / gool

System TUN manager (one child only)
  - Xray adapter (default)
  - sing-box adapter (fallback)
```

Do not scatter `if engine == ...` checks through Aether lifecycle code. Engine selection belongs at the system-TUN boundary.

## Profile and elevation boundary

`ConnectionProfile` persists `tun_engine` with Xray as the migration-safe default.

For a TUN connection:

1. the normal process loads and sanitizes the exact profile;
2. it records the selected TUN engine;
3. it resolves Aether and that engine before elevation;
4. it stores a one-shot pending profile;
5. the elevated copy consumes the same profile and resumes connection;
6. no downloader or version mutation runs while elevated.

Because the application supports one active connection, the selected engine is stored atomically before launch and remains fixed for that connection generation.

## No legacy compatibility branches

The project does not keep old code paths merely to preserve historical GUI behavior.

Allowed resilience mechanisms are:

- capability discovery from the currently selected external core;
- verified side-by-side versions;
- explicit user downgrade;
- bundled recovery after a proven incompatible core release;
- configuration validation before changing system routes;
- an explicit alternative TUN engine selected by the user.

These are forward-compatibility and safety mechanisms, not support for obsolete internal implementations.

When a new implementation replaces an old one, remove the old implementation and its aliases instead of maintaining two lifecycle owners.

## TUN safety

Before the application reports system-wide protection:

1. the selected Xray or sing-box binary must exist as a managed or bundled core;
2. the generated configuration must pass the engine's native validation command;
3. the exact Aether executable path must bypass the TUN so the outer Cloudflare connection cannot recurse into Aether SOCKS;
4. the selected TUN process must bypass its own interface;
5. automatic route creation and outbound-interface detection must be enabled;
6. the interface must be dual-stack;
7. Windows DNS must be assigned to the TUN path when the selected engine supports it;
8. the complete data path must be verified after startup and periodically afterward.

For every address family that has usable system egress, the direct system probe must correlate with the egress observed through Aether's SOCKS path. Public IP values are compared in memory and are not persisted in diagnostics.

The SOCKS listener is loopback-only because the upstream proxy endpoint does not provide GUI-managed proxy authentication.

### Why Xray is the Windows default

The sing-box v1.13 fallback can create routes and hijack port 53 internally, but it does not reliably assign Windows interface DNS in every environment. With strict routing, Windows may continue querying an unavailable physical-interface resolver and the system probe stalls at hostname resolution.

Xray's native TUN settings expose `gateway`, `dns`, `autoSystemRoutingTable`, and `autoOutboundsInterface`, allowing the adapter to configure the Windows Wintun interface and DNS path as one validated unit.

## Process and memory ownership

Every child process is owned by one manager object.

- only one Xray or sing-box system-TUN process can be active;
- TUN stdout and stderr are drained for the full process lifetime;
- Aether PTY output is drained by one bounded reader loop;
- forced termination performs kill plus process reaping;
- reconnect attempts are bounded;
- live frontend logs are bounded;
- partial PTY input is capped;
- orphan cleanup validates saved PID plus expected executable identity before force-killing anything.

Never kill processes globally by image name.

## Diagnostics privacy

Before writing diagnostics to disk:

- obvious credentials and tokens are replaced with a redacted marker;
- the user's home/profile directory is replaced with `~`;
- TUN public egress IP values are never included in health-check errors.

## Performance and binary size

Keep the desktop control plane small:

- do not reimplement Aether's network protocols;
- do not run Xray and sing-box simultaneously;
- do not duplicate core updater implementations;
- keep the React live-log buffer bounded;
- pause decorative motion while the window is unfocused;
- prefer one shared Core Registry and one system-TUN lifecycle owner.

New dependencies must justify their binary-size and startup-cost impact.
