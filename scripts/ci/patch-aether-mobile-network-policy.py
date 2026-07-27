#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MASQUE_MARKER = "Android auto H2 latency window"
WG_MARKER = "Android bounded official WARP scan"


def target_root(argument: str | None) -> Path:
    return Path(argument).resolve() if argument else ROOT


def replace_pattern(
    source: str,
    pattern: str,
    replacement: str,
    label: str,
) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f"could not patch {label}; expected exactly one source block")
    return updated


root = target_root(sys.argv[1] if len(sys.argv) > 1 else None)
core = root / "vendor/aether/aether/src"
prober_path = core / "prober.rs"
wg_prober_path = core / "wg_prober.rs"
wireguard_path = core / "wireguard.rs"

for path in (prober_path, wg_prober_path, wireguard_path):
    if not path.is_file():
        raise SystemExit(f"Aether source file was not found: {path}")

prober = prober_path.read_text(encoding="utf-8")
if MASQUE_MARKER not in prober:
    prober = replace_pattern(
        prober,
        r"ScanMode::Turbo => Strategy \{.*?\n\s*\},\n\s*ScanMode::Balanced => Strategy \{",
        '''ScanMode::Turbo => Strategy {
                // Android auto H2 latency window: wait briefly after the first
                // verified gateway so Auto can choose the lowest-latency result
                // without turning a normal connection into a long scan.
                concurrency: 20,
                per_probe_timeout: Duration::from_secs(4),
                overall_deadline: Duration::from_secs(8),
                settle_after_target: Duration::from_millis(650),
                target_successes: 1,
                early_exit_first: false,
                sample_per_cidr: 24,
                finalists: 4,
                finalist_attempts: 1,
                secondary_port_passes: 0,
                include_compat_ranges: false,
            },
            ScanMode::Balanced => Strategy {''',
        "MASQUE Turbo strategy",
    )

wg_prober = wg_prober_path.read_text(encoding="utf-8")
if WG_MARKER not in wg_prober:
    wg_prober = replace_pattern(
        wg_prober,
        r"WgScanMode::Ironclad => WgStrategy \{.*?\n\s*\},\n\s*\}\n\s*\}",
        '''WgScanMode::Ironclad => WgStrategy {
                // Android bounded official WARP scan: explicit WireGuard/Gool
                // still require real HTTP egress, but should fail clearly rather
                // than cycling through thousands of compatibility endpoints.
                concurrency: 8,
                per_probe_timeout: Duration::from_secs(8),
                overall_deadline: Duration::from_secs(60),
                settle_after_target: Duration::from_secs(2),
                target_successes: 6,
                early_exit_first: false,
                sample_per_cidr: 64,
                finalists: 4,
                finalist_attempts: 2,
                include_compatibility: false,
                compatibility_ports: 0,
            },
        }
    }''',
        "WireGuard Ironclad strategy",
    )

wireguard = wireguard_path.read_text(encoding="utf-8")
if WG_MARKER not in wireguard:
    replacement = '''// Android bounded official WARP scan: consumer WARP uses the documented
// ingress pool and the four documented WireGuard UDP ports. Compatibility
// ranges remain an upstream concern and are not scanned by the mobile build.
pub const WG_PREFIXES_V4: &[&str] = &["162.159.192.0/24"];
pub const WG_PRIMARY_PREFIXES_V4: &[&str] = WG_PREFIXES_V4;
pub const WG_PREFIXES_V6: &[&str] = &["2606:4700:100::/48"];
pub const WG_PRIMARY_PREFIXES_V6: &[&str] = WG_PREFIXES_V6;

pub const WG_PORTS: &[u16] = &[2408, 500, 1701, 4500];
pub const WG_PRIMARY_PORTS: &[u16] = WG_PORTS;

pub const WG_SEEDS_V4: &[&str] = &["162.159.192.1", "162.159.192.2"];

pub const WG_SEEDS_V6: &[&str] = &["2606:4700:100::1"];'''
    wireguard = replace_pattern(
        wireguard,
        r"pub const WG_PREFIXES_V4:.*?pub const WG_SEEDS_V6:.*?\n\];",
        replacement,
        "official WireGuard ranges and ports",
    )

for name, source, marker in (
    ("prober.rs", prober, MASQUE_MARKER),
    ("wg_prober.rs", wg_prober, WG_MARKER),
    ("wireguard.rs", wireguard, WG_MARKER),
):
    if marker not in source:
        raise SystemExit(f"{name}: mobile network policy marker is missing")

if "early_exit_first: false" not in prober or "Duration::from_millis(650)" not in prober:
    raise SystemExit("MASQUE Auto latency sampling policy was not applied")
if "overall_deadline: Duration::from_secs(60)" not in wg_prober:
    raise SystemExit("bounded WireGuard Ironclad deadline was not applied")
if "188.114.96.0/24" in wireguard or "854," in wireguard:
    raise SystemExit("legacy WireGuard compatibility ranges or ports remain")
if "pub const WG_PORTS: &[u16] = &[2408, 500, 1701, 4500];" not in wireguard:
    raise SystemExit("official WireGuard port set was not applied")

prober_path.write_text(prober, encoding="utf-8")
wg_prober_path.write_text(wg_prober, encoding="utf-8")
wireguard_path.write_text(wireguard, encoding="utf-8")
print(f"Applied Android mobile transport discovery policy in {core}")
