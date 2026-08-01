#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MARKER = "Android WireGuard one-shot post-handshake junk"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block, found {count}")
    return source.replace(old, new, 1)


root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
path = root / "vendor/aether/aether/src/wireguard.rs"
if not path.is_file():
    raise SystemExit(f"Aether wireguard.rs was not found: {path}")

source = path.read_text(encoding="utf-8")
if MARKER not in source:
    source = replace_once(
        source,
        '''        let ever_received = Arc::new(AtomicBool::new(self.established));
        let ever_received_r = ever_received.clone();
        let ever_received_h = ever_received.clone();
        let started_at = Instant::now();
''',
        '''        let ever_received = Arc::new(AtomicBool::new(self.established));
        let ever_received_r = ever_received.clone();
        let ever_received_h = ever_received.clone();
        // Android WireGuard one-shot post-handshake junk: the receive path can
        // authenticate every transport packet. Emit the post-handshake pattern
        // once per fresh runtime, and never repeat it for a retained session.
        let post_handshake_junk_sent = Arc::new(AtomicBool::new(self.established));
        let post_handshake_junk_sent_r = post_handshake_junk_sent.clone();
        let started_at = Instant::now();
''',
        "WireGuard one-shot state",
    )
    source = replace_once(
        source,
        '''                if batch.authenticated {
                    mark_valid_rx(&last_valid_rx_r, &ever_received_r);
                    aethernoize::send_post_handshake_junk(&sock_r, peer, &aethernoize_r).await;
                }
''',
        '''                if batch.authenticated {
                    mark_valid_rx(&last_valid_rx_r, &ever_received_r);
                    if !post_handshake_junk_sent_r.swap(true, Ordering::SeqCst) {
                        aethernoize::send_post_handshake_junk(
                            &sock_r,
                            peer,
                            &aethernoize_r,
                        )
                        .await;
                    }
                }
''',
        "WireGuard one-shot send",
    )

for required in (
    MARKER,
    "AtomicBool::new(self.established)",
    "post_handshake_junk_sent_r.swap(true, Ordering::SeqCst)",
):
    if required not in source:
        raise SystemExit(f"wireguard.rs: missing one-shot junk invariant: {required}")

if source.count("send_post_handshake_junk(") != 1:
    raise SystemExit("wireguard.rs: post-handshake junk must have exactly one call site")

path.write_text(source, encoding="utf-8")
print(f"Applied one-shot WireGuard post-handshake junk policy in {path}")
