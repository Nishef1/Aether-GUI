# Aether v2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Aether-GUI to Aether v2 while reducing connection latency, preserving valuable custom reliability features, and shipping capability-driven mobile-first UX across Windows, Linux, macOS and Android.

**Architecture:** Upstream Aether v2 is the canonical core base. Custom behavior is reintroduced only through a documented patch ledger. Connection startup separates safety from quality so Turbo reaches the first usable protected route without waiting for capacity/latency benchmarking.

**Tech Stack:** TypeScript/React 19/Tauri 2, Rust, Kotlin/Android VpnService, HEV, sing-box, Aether v2/Rust 1.98.

**Spec:** `docs/superpowers/specs/2026-09-18-aether-v2-migration-design.md`

## Global Constraints

- Turbo accepts the first usable route; speed/RTT/jitter/capacity never gate Turbo.
- Safety checks remain fail-closed for real data-plane failure, evidenced identity leak and system-tunnel failure.
- Aether core owns scan deadlines; wrappers keep only safety margins/watchdogs.
- Existing desktop and Android TUN architectures remain separate from the core.
- MIM starts Experimental/manual and is excluded from default Automatic.
- Tor is a privacy-route axis, not a normal transport fallback.
- Full-device Tor stays gated until the upstream UDP/DNS limitation is handled and verified.
- UI is capability-driven and mobile-first.
- Do not advance the packaged runtime pin to v2 until migration gates pass.

---

### Task 1: Make Turbo reachability-first

**Files:**
- Create: `scripts/tests/test_turbo_connect_policy.mjs`
- Modify: `package.json`
- Modify: `src/lib/automaticPolicy.ts`
- Modify: `src/lib/autoConnect.ts`
- Modify: `src-tauri/src/connection_acceptance.rs`
- Modify: `src-tauri/src/aether/status.rs`
- Modify: `src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt`
- Modify: `src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt`
- Modify: `src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt`

**Interfaces:**
- Produces: one clear policy split between connection-critical safety and post-connect quality.
- Produces: Turbo candidate ordering that does not require quality-confidence/latency evidence.
- Produces: post-connect capacity sampling that does not delay Ready.

- [x] Add a failing policy regression contract.
- [x] Verify the test fails for the current synchronous quality gates.
- [x] Implement the minimum policy split.
- [x] Verify focused tests/type checks/contracts.
- [x] Review for regressions in disconnect/recovery and Android fail-closed behavior.

### Task 2: Remove duplicate timeout authority

**Files:**
- Modify: `src/lib/automaticPolicy.ts`
- Modify: `src/lib/autoConnect.ts`
- Modify: `src-tauri/src/aether/status.rs`
- Modify: `src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt`
- Modify/add focused policy tests/contracts.

- [ ] Define core-owned scan budget contract.
- [ ] Reduce frontend/native tables to safety margins only.
- [ ] Preserve bounded cancellation and recovery.
- [ ] Verify timeout behavior for each scan mode and transport.

### Task 3: Create the fork patch ledger and v2 pristine baseline

**Files:**
- Create: `FORK_PATCHES.md`
- Modify: custom Aether fork as required.
- Do not change GUI runtime pin yet.

- [ ] Inventory custom commits since the v1.9 baseline.
- [ ] Classify every patch Adopt / Keep-Port / Rework / Drop.
- [ ] Establish v2.0.0 canonical base in the fork.
- [ ] Verify upstream v2 builds before custom patches are reintroduced.

### Task 4: Port only justified custom-core behavior

**Files:**
- Modify relevant `Nishef1/Aether/aether/src/*` files according to the ledger.

- [ ] Port network-scoped path history.
- [ ] Port/rework adaptive liveness policy.
- [ ] Port deterministic H2 masks on top of v2 TLS/H2.
- [ ] Port WiW cooldown/reliability behavior only where not superseded.
- [ ] Delete obsolete v1.9 SOCKS/resource patches superseded by v2.
- [ ] Verify custom patch tests.

### Task 5: Add capability and ProfileV2 contracts

**Files:**
- Modify: `src/types/connection.ts`
- Modify: `src/lib/nativeProfile.ts`
- Modify: `src-tauri/src/aether/profiles.rs`
- Modify: native command/capability surfaces.
- Modify: Android profile parity.

- [ ] Add core capability descriptor.
- [ ] Add MIM transport fields.
- [ ] Add privacy-route/Tor topology fields.
- [ ] Add backward-compatible ProfileV1 -> ProfileV2 migration.
- [ ] Preserve session-only secrets.

### Task 6: Reconcile Automatic policy with v2

**Files:**
- Modify: `src/lib/automaticPolicy.ts`
- Modify: `src/lib/autoConnect.ts`
- Modify: `src/lib/pathIntelligence.ts`
- Modify related stores/contracts.

- [ ] Preserve H2/WG/H3 reachability fallback.
- [ ] Keep WiW last by default.
- [ ] Keep MIM out of default Automatic.
- [ ] Make history a shortcut/order signal rather than a Turbo quality gate.
- [ ] Consolidate duplicated path scoring when safe.

### Task 7: Integrate v2 desktop and Android packaging

**Files:**
- Modify: `scripts/prepare-custom-aether.mjs`
- Modify: `scripts/prepare-android-native.sh`
- Modify: `scripts/prepare-android-native.mjs`
- Modify Tauri/Android packaging as needed.

- [ ] Build/package v2 core.
- [ ] Package Tor-enabled desktop artifacts and `pt/` assets where supported.
- [ ] Package corresponding Android assets.
- [ ] Keep desktop sing-box and Android HEV architecture unchanged.
- [ ] Verify runtime capability reporting matches packaged features.

### Task 8: Integrate MIM and Tor safely

- [ ] Add manual MIM end-to-end flow and diagnostics.
- [ ] Gate MIM as Experimental pending real-network evidence.
- [ ] Add Tor privacy-route modes.
- [ ] Resolve/adapt Tor DNS over full-device TUN before advertising support.
- [ ] Verify disconnect/reconnect and no-leak behavior.

### Task 9: Redesign the primary cross-platform UX

**Files:**
- Modify: `src/components/QuickConnectionCard.tsx`
- Modify: `src/components/ProtocolSelect.tsx`
- Modify: `src/components/ScanModeToggle.tsx`
- Modify: `src/components/CoreAdvancedSettings.tsx`
- Modify: `src/components/ConnectionDiagnostics.tsx`
- Modify: `src/components/ConnectionStatusLine.tsx`
- Modify related UI contracts/styles.

- [ ] Replace Fast/Gaming copy with truthful Fast-connect semantics.
- [ ] Keep common mobile-first primary controls small.
- [ ] Move Stealth/Ironclad and protocol internals to Advanced.
- [ ] Add capability-driven transport/privacy-route controls.
- [ ] Add topology-aware diagnostics.
- [ ] Verify touch, keyboard, screen-reader and reduced-motion behavior.

### Task 10: Acceptance gates and runtime pin

- [ ] Core parity matrix passes.
- [ ] Lifecycle stress passes.
- [ ] Desktop full-device gates pass.
- [ ] Android full-device/background/network-switch gates pass.
- [ ] MIM real-network gate passes.
- [ ] Tor/TUN/DNS gate passes.
- [ ] Battery/idle/reconnect checks pass.
- [ ] Update runtime manifest/custom-core pin to v2 custom build.
- [ ] Update architecture/build/README docs.
- [ ] Perform final whole-change review before merge/release.
