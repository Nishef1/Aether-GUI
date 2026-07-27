#!/usr/bin/env python3

from __future__ import annotations

import runpy
import sys
from pathlib import Path


# Keep this filename as a compatibility entrypoint because the original Android
# preparation script and older developer commands invoke it directly. The old
# implementation retained the scanner's BoringTun session, which is the runtime
# path that fails on Android after raw endpoint validation. Delegate to the one
# source of truth that restores a fresh runtime for WireGuard and Gool.
PATCHER = Path(__file__).with_name("patch-aether-android-fresh-runtime.py")
if not PATCHER.is_file():
    raise SystemExit(f"fresh Android WireGuard runtime patch is missing: {PATCHER}")

sys.argv = [str(PATCHER), *sys.argv[1:]]
runpy.run_path(str(PATCHER), run_name="__main__")
