#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MARKER = "Android MASQUE H3 channel lifecycle"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block, found {count}")
    return source.replace(old, new, 1)


root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
path = root / "vendor/aether/aether/src/quic.rs"
if not path.is_file():
    raise SystemExit(f"Aether quic.rs was not found: {path}")

source = path.read_text(encoding="utf-8")
if MARKER not in source:
    source = replace_once(
        source,
        '''    let mut probe_interval = tokio::time::interval(Duration::from_millis(700));
    probe_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {''',
        '''    let mut probe_interval = tokio::time::interval(Duration::from_millis(700));
    probe_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // Android MASQUE H3 channel lifecycle: a closed Tokio receiver remains
    // immediately ready forever. Disable each branch after closure so the
    // tunnel can flush its close frame instead of spinning on the CPU.
    let mut ctrl_open = true;
    let mut outbound_open = true;

    loop {''',
        "H3 channel state",
    )
    source = replace_once(
        source,
        '''            ctrl = internals.ctrl_rx.recv() => {
                match ctrl {
                    Some(Control::Migrate) => {
                        if let Err(error) = do_migrate(
                            &mut conn,
                            peer,
                            &mut sockets,
                            &net_tx,
                            &mut readers,
                        ).await {
                            log::warn!("migration failed: {error}");
                        }
                    }
                    Some(Control::Close) | None => {
                        let _ = conn.close(true, 0x00, b"bye");
                    }
                }
            }
''',
        '''            ctrl = internals.ctrl_rx.recv(), if ctrl_open => {
                match ctrl {
                    Some(Control::Migrate) => {
                        if let Err(error) = do_migrate(
                            &mut conn,
                            peer,
                            &mut sockets,
                            &net_tx,
                            &mut readers,
                        ).await {
                            log::warn!("migration failed: {error}");
                        }
                    }
                    Some(Control::Close) => {
                        ctrl_open = false;
                        let _ = conn.close(true, 0x00, b"bye");
                    }
                    None => {
                        ctrl_open = false;
                        let _ = conn.close(true, 0x00, b"bye");
                    }
                }
            }
''',
        "H3 control receiver lifecycle",
    )
    source = replace_once(
        source,
        '''            packet = internals.outbound_rx.recv() => {
                match packet {''',
        '''            packet = internals.outbound_rx.recv(), if outbound_open => {
                match packet {''',
        "H3 outbound receiver guard",
    )
    source = replace_once(
        source,
        '''                    None => {
                        let _ = conn.close(true, 0x00, b"eof");
                    }
                }
            }
''',
        '''                    None => {
                        outbound_open = false;
                        let _ = conn.close(true, 0x00, b"eof");
                    }
                }
            }
''',
        "H3 outbound receiver lifecycle",
    )

for required in (
    MARKER,
    "ctrl = internals.ctrl_rx.recv(), if ctrl_open",
    "packet = internals.outbound_rx.recv(), if outbound_open",
    "ctrl_open = false",
    "outbound_open = false",
):
    if required not in source:
        raise SystemExit(f"quic.rs: missing H3 lifecycle invariant: {required}")

path.write_text(source, encoding="utf-8")
print(f"Applied MASQUE H3 closed-channel lifecycle policy in {path}")
