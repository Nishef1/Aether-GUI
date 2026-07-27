from pathlib import Path
import re

path = Path("src-tauri/gen/android/app/build.gradle.kts")
text = path.read_text(encoding="utf-8")
marker_match = re.search(r"(?m)^android\s*\{\r?\n", text)

if marker_match is None:
    raise SystemExit("generated app build.gradle.kts has no android block")

marker = marker_match.group(0)
newline = "\r\n" if "\r\n" in marker else "\n"
block = (
    marker
    + f"    packaging {{{newline}"
    + f"        jniLibs {{{newline}"
    + f"            useLegacyPackaging = true{newline}"
    + f"        }}{newline}"
    + f"    }}{newline}"
)

if "useLegacyPackaging = true" not in text:
    text = text.replace(marker, block, 1)
    path.write_text(text, encoding="utf-8", newline="")

updated = path.read_text(encoding="utf-8")
if "useLegacyPackaging = true" not in updated:
    raise SystemExit("native-library extraction packaging was not enabled")

print(f"Verified Android native-library packaging: {path}")
