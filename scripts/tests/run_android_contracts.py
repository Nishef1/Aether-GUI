#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TESTS = (
    "scripts/tests/test_android_plugin_contract.py",
    "scripts/tests/test_android_rust_plugin_dependency.py",
    "scripts/tests/test_android_mobile_config.py",
    "scripts/tests/test_android_mobile_efficiency.py",
    "scripts/tests/test_android_transport_contract.py",
    "scripts/tests/test_android_runtime_resilience.py",
    "scripts/tests/test_android_wg_junk_policy.py",
)


def main() -> int:
    for relative in TESTS:
        test = ROOT / relative
        if not test.is_file():
            print(f"Required Android contract test is missing: {test}", file=sys.stderr)
            return 2
        print(f"\n==> {relative}", flush=True)
        result = subprocess.run([sys.executable, str(test)], cwd=ROOT, check=False)
        if result.returncode != 0:
            return result.returncode
    print("\nAll Android source contracts passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
