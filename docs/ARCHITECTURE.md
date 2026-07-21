# Aether-GUI Architecture

## Product boundary

Aether-GUI is a desktop control plane. It does not reimplement Aether's censorship-circumvention protocols.

The current data path is:

```text
Applications / OS traffic
        |
        | optional system-wide TUN
        v
     sing-box
        |
        v
Aether local SOCKS5 (loopback only)
        |
        v
Aether tunnel / upstream network
```

The GUI release lifecycle is independent from the Aether and sing-box release lifecycles.

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
- provide a bundled recovery binary when no managed binary is usable;
- quarantine an Aether release that proves incompatible during early startup.

Managed core layout:

```text
app-data/
  cores/
    aether/
      active-version.txt
      rejected-version.txt
      aether-vX.Y.Z[.exe]
      aether-vNext[.exe]
    singbox/
      active-version.txt
      sing-box-vX.Y.Z[.exe]
      sing-box-vNext[.exe]
  tun/
    singbox-config.json
    singbox.pid
  logs/
    aether-gui.jsonl
    aether-gui.jsonl.1
```

Versioned binaries are never overwritten by switching versions. Selecting a version only changes the small active-version pointer while disconnected.

The bundled binary is a safety recovery path, not a legacy API compatibility layer.

## Engine adapters

Binary/version management and network-engine behavior are deliberately separate.

- `src-tauri/src/aether/` owns Aether-specific launch arguments, PTY interaction, connection supervision and SOCKS readiness.
- `src-tauri/src/singbox/` owns system-wide TUN configuration, sing-box process supervision and TUN health verification.
- `src-tauri/src/core_manager.rs` owns versions and binary selection only.

A future Xray integration should follow the same boundary:

```text
Core Registry
  - Aether binary versions
  - sing-box binary versions
  - Xray binary versions (future)

Engine adapters
  - AetherAdapter
  - XrayAdapter (future)

System routing adapter
  - sing-box TUN
```

Do not add Xray by scattering `if core == xray` checks through Aether code. Add an Xray lifecycle/config adapter and register its binary descriptor in the shared Core Registry.

## No legacy compatibility branches

The project does not keep old code paths merely to preserve historical GUI behavior.

Allowed resilience mechanisms are:

- capability discovery from the currently selected external core;
- verified side-by-side versions;
- explicit user downgrade;
- bundled recovery after a proven incompatible core release;
- configuration validation before changing system routes.

These are forward-compatibility and safety mechanisms, not support for obsolete internal implementations.

When a new implementation replaces an old one, remove the old implementation and its aliases instead of maintaining two paths.

## TUN safety

Before sing-box changes system routes:

1. the selected sing-box binary must exist as a managed or bundled core;
2. the generated configuration is validated with `sing-box check`;
3. Aether's exact executable path is routed directly so versioned executable names cannot create a routing loop;
4. sing-box itself is routed directly;
5. automatic route creation and default-interface detection are enabled;
6. strict routing is enabled;
7. the TUN interface is dual-stack;
8. the complete data path is verified after startup and periodically afterward.

For every IP family that has usable system egress, the direct system probe must match the egress observed through Aether's SOCKS path. Public IP values are compared in memory and are not persisted in diagnostics.

The SOCKS listener is loopback-only because the upstream proxy endpoint does not provide GUI-managed proxy authentication.

## Process and memory ownership

Every child process is owned by a manager object.

- sing-box stdout and stderr are drained for the full process lifetime;
- Aether PTY output is drained by one bounded reader loop;
- Aether forced termination performs kill plus process reaping;
- sing-box forced termination performs kill plus wait;
- reconnect attempts are bounded;
- live frontend logs retain only the latest 500 entries;
- partial PTY input is capped at 16 KiB;
- orphan cleanup validates saved PID plus expected executable identity before force-killing anything.

Never kill processes globally by image name.

## Privilege boundary

Normal proxy-only operation is non-elevated.

For TUN:

1. required verified core binaries are prepared before elevation;
2. a one-shot pending connection profile is saved;
3. the GUI relaunches with platform elevation;
4. the elevated process uses already-installed binaries;
5. core installation/version changes are rejected while elevated.

Long term, a dedicated minimal privileged helper would provide an even smaller privilege surface than relaunching the complete Tauri process. Until that migration is implemented, no downloader or updater is allowed to run in the elevated path.

## Diagnostics privacy

Persistent JSONL diagnostics rotate at approximately 5 MiB.

Before writing to disk:

- obvious credentials and tokens are replaced with a redacted marker;
- the user's home/profile directory is replaced with `~`;
- TUN public egress IP values are never included in health-check errors.

## Performance and binary size

Keep the desktop control plane small:

- do not add a second networking stack when system tools and small verified installers are sufficient;
- do not duplicate core updater implementations;
- keep the React live-log buffer bounded;
- pause decorative motion while the window is unfocused;
- prefer one shared Core Registry over per-engine download frameworks.

New dependencies must justify their binary-size and startup-cost impact.
