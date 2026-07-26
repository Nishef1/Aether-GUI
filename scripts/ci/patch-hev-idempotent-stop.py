#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


if len(sys.argv) != 2:
    raise SystemExit("usage: patch-hev-idempotent-stop.py <hev-source-dir>")

root = Path(sys.argv[1]).resolve()
source = root / "src/hev-socks5-tunnel.c"
text = source.read_text(encoding="utf-8")

if "static int stop_requested;" not in text:
    text = text.replace(
        "static int run;\nstatic int tun_fd = -1;",
        "static int run;\nstatic int stop_requested;\nstatic int tun_fd = -1;",
        1,
    )

old_event_tail = """    task_event = hev_task_new (-1);
    if (!task_event) {
        LOG_E (\"socks5 tunnel task event\");
        return -1;
    }

    return 0;
}"""
new_event_tail = """    task_event = hev_task_new (-1);
    if (!task_event) {
        LOG_E (\"socks5 tunnel task event\");
        return -1;
    }

    /* A disconnect can arrive immediately after pthread_create, before the
     * event socket exists. Preserve that request and queue it as soon as async
     * initialization reaches a stoppable state. */
    if (READ_ONCE (stop_requested)) {
        unsigned char signal = 1;
        ssize_t written = write (event_fds[1], &signal, sizeof (signal));
        if (written < 0 && errno != EAGAIN && errno != EWOULDBLOCK)
            LOG_W (\"socks5 tunnel pending stop event\");
    }

    return 0;
}"""
if old_event_tail in text:
    text = text.replace(old_event_tail, new_event_tail, 1)
elif "socks5 tunnel pending stop event" not in text:
    raise SystemExit("event-task stop-pending insertion point was not found")

old_fini_stats = """    stat_tx_packets = 0;
    stat_rx_packets = 0;
    stat_tx_bytes = 0;
    stat_rx_bytes = 0;
}"""
new_fini_stats = """    stat_tx_packets = 0;
    stat_rx_packets = 0;
    stat_tx_bytes = 0;
    stat_rx_bytes = 0;
    WRITE_ONCE (stop_requested, 0);
}"""
if old_fini_stats in text:
    text = text.replace(old_fini_stats, new_fini_stats, 1)
elif "WRITE_ONCE (stop_requested, 0);" not in text:
    raise SystemExit("stop-pending reset insertion point was not found")

old_stop = """void
hev_socks5_tunnel_stop (void)
{
    int res;
    int fd;

    LOG_D (\"socks5 tunnel stop\");

    for (;;) {
        fd = READ_ONCE (event_fds[1]);
        if (fd >= 0)
            break;
        /* Wait for async initialization */
        usleep (100 * 1000);
    }

    res = write (fd, &res, 1);
    assert (res > 0 && \"socks5 tunnel write event\");
}"""
new_stop = """void
hev_socks5_tunnel_stop (void)
{
    unsigned char signal = 1;
    ssize_t written;
    int fd;

    LOG_D (\"socks5 tunnel stop\");
    WRITE_ONCE (stop_requested, 1);

    fd = READ_ONCE (event_fds[1]);
    if (fd < 0)
        return;

    written = write (fd, &signal, sizeof (signal));
    if (written < 0 && errno != EAGAIN && errno != EWOULDBLOCK)
        LOG_W (\"socks5 tunnel stop event\");
}"""
if old_stop in text:
    text = text.replace(old_stop, new_stop, 1)
elif "WRITE_ONCE (stop_requested, 1);" not in text:
    raise SystemExit("hev stop function did not match the pinned source")

for forbidden in (
    'assert (res > 0 && "socks5 tunnel write event")',
    "for (;;) {\n        fd = READ_ONCE (event_fds[1]);",
):
    if forbidden in text:
        raise SystemExit(f"unsafe hev stop code remains: {forbidden}")

source.write_text(text, encoding="utf-8")
print("patched hev-socks5-tunnel stop for idempotent early/concurrent teardown")
