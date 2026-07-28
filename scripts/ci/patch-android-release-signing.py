from pathlib import Path
import re


path = Path("src-tauri/gen/android/app/build.gradle.kts")
text = path.read_text(encoding="utf-8")

# Tauri's generated Android project leaves the release variant unsigned unless a
# signing config is supplied. Use Android's standard local signing key so the
# release-mode APK can be sideloaded for testing without loading the Vite dev
# server. A store-distribution key can replace this later in CI.
release_match = re.search(
    r'(?m)^(?P<indent>\s*)getByName\("release"\) \{\r?\n', text
)
if release_match is None:
    raise SystemExit("generated app build.gradle.kts has no release build type")

if "signingConfig = signingConfigs.getByName(\"debug\")" not in text:
    indent = release_match.group("indent")
    newline = "\r\n" if "\r\n" in release_match.group(0) else "\n"
    replacement = (
        release_match.group(0)
        + f'{indent}    signingConfig = signingConfigs.getByName("debug"){newline}'
    )
    text = text.replace(release_match.group(0), replacement, 1)
    path.write_text(text, encoding="utf-8", newline="")

updated = path.read_text(encoding="utf-8")
if "signingConfig = signingConfigs.getByName(\"debug\")" not in updated:
    raise SystemExit("release APK signing was not configured")

print(f"Verified Android release APK signing: {path}")
