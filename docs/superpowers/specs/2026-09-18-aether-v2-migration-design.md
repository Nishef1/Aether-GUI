# Aether v2 Migration Design

**Date:** 2026-09-18  
**Status:** Approved for implementation  
**Repositories:** `Nishef1/Aether-GUI`, `Nishef1/Aether`  
**Upstream baseline:** `CluvexStudio/Aether v2.0.0`

## Product intent

Move Aether-GUI to Aether v2 without discarding the custom work that materially improves reachability, lifecycle safety, privacy, or cross-platform UX. Prefer upstream v2 whenever it is simpler or more correct. Preserve custom behavior only when it has a concrete advantage and a verification gate.

The primary connection KPI is **Time To Protected**, not route-score maximization.

## Scan-mode contracts

- **Turbo:** accept the first usable route. Speed, RTT, jitter, capacity and quality scoring are post-connect observations only and never gate acceptance.
- **Balanced:** compare a bounded set of candidates and prefer a better route without turning startup into a benchmark.
- **Thorough:** prioritize coverage over startup latency.
- **Stealth:** reduce discovery concurrency/probe activity.
- **Ironclad:** pay the cost of real data-plane verification before accepting a candidate.

Safety remains separate from quality. A route may be rejected before Ready for a real data-plane failure, an evidenced identity leak, a failed system tunnel, or an invalid transport. Poor throughput is quality evidence, not a Turbo connection failure.

## Connection architecture

Desktop remains:

`Aether transport -> loopback SOCKS -> SystemTunnelAdapter -> sing-box TUN -> OS`

Android remains:

`Aether transport -> loopback SOCKS -> HEV -> Android VpnService`

Aether core owns transport discovery deadlines. Native wrappers own only process/service safety watchdogs. Frontend Automatic orchestration must not define a second independent scan-deadline system.

Connection-critical path:

`launch -> discover -> transport usable -> minimum safety -> system tunnel -> Ready`

Post-connect observation:

`exit identity -> latency/jitter -> capacity -> history update`

## Custom patch policy

Every custom-core delta is classified as one of:

- **Adopt upstream** — upstream v2 implementation is better; delete the fork patch.
- **Keep/Port** — custom behavior has a demonstrated advantage and moves onto v2.
- **Rework** — the intent remains valid but implementation should target the v2 architecture.
- **Drop/Superseded** — no longer justified.

Maintain `FORK_PATCHES.md` with reason, upstream equivalent, touched files, removal condition and tests.

Expected Keep/Port or Rework areas:
- network-scoped path history and last-known-good ordering;
- adaptive network/liveness policy;
- deterministic H2 compatibility masks;
- WiW cooldown/retry reliability;
- privacy-safe probing and connection diagnostics.

Expected Adopt-upstream areas:
- v2 SOCKS client lifecycle/resource limiting;
- `egress.rs` and Linux socket-mark support;
- MIM core implementation;
- Tor/arti integration and bridge/PT support;
- QUIC v2 bait and other v2 transport fixes.

## Aether v2 feature model

Transport axis:
- Automatic
- MASQUE
- WireGuard
- WARP-in-WARP
- MIM (initially Experimental/manual; not part of default Automatic)

Privacy-route axis:
- Standard
- Tor after tunnel (`Aether/WARP -> Tor`)
- Tunnel through Tor (`Tor -> Aether/WARP`)
- Tor only (Advanced)

Tor is not a normal transport fallback.

## Capability-driven UI

Native exposes runtime capabilities instead of frontend version comparisons. The UI renders only features supported by the packaged core/platform combination.

Capabilities include at least:
- MASQUE H3/H2
- WireGuard
- WARP-in-WARP
- MIM
- Tor / Tor-reverse / Tor-only
- HTTP CONNECT
- upstream proxy
- ECH
- H2 mask modes
- socket mark
- full-device support for each privacy topology when applicable

## Cross-platform UX

The primary surface remains mobile-first and shared where possible.

Primary controls:
- connection goal;
- transport;
- privacy route;
- DNS protection;
- Connect.

Advanced-only controls include Stealth/Ironclad, manual endpoints, low-level compatibility masks, TLS overrides, route rules and troubleshooting switches.

The existing `Fast / Gaming` concept becomes **Fast connect** semantics. It must not imply lowest latency, because Turbo intentionally accepts the first usable route.

Diagnostics become topology-aware and may show:
- selected transport;
- outer/inner hops for nested routes;
- WARP/Tor order;
- protected exit IP/country;
- system-tunnel protection;
- DNS status;
- post-connect quality measurements.

## Known v2 integration constraints

- Upstream issue #117: Tor SOCKS rejects UDP ASSOCIATE, so TUN frontends can fail DNS. Full-device Tor must remain gated until the DNS/TUN adaptation is verified.
- Upstream issue #120: MIM has user-reported inconsistent behavior on some networks. Keep MIM Experimental until acceptance testing passes on real networks.

## Release gates

1. **Turbo/connection policy:** first-usable semantics, no capacity/latency gating.
2. **Core parity:** H2/H3/WG/WiW across supported IP families and scan modes.
3. **Lifecycle:** repeated connect/disconnect/recovery without stale state, orphan processes, leaked TUNs or port collisions.
4. **Data plane:** real traffic, DNS, exit identity and failure classification.
5. **Desktop full-device:** Windows/Linux/macOS.
6. **Android:** permission, foreground service, HEV, DNS, background/screen-off, network switch and reconnect.
7. **MIM:** traffic, protected exit, reconnect/disconnect, multi-network evidence.
8. **Tor:** packaging/PT, DNS/TUN behavior, desktop and Android acceptance.
9. **Battery:** idle CPU/wakeups, keepalive cost, reconnect churn and Tor steady-state.
10. **Release:** update runtime pin only after the above gates.

## Non-goals

- Rewriting the entire GUI before core parity.
- Moving system-TUN ownership into the Aether fork.
- Adding MIM to Automatic before evidence.
- Treating throughput as a safety check.
- Preserving fork code solely because it already exists.
