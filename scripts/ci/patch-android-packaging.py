from pathlib import Path

path = Path("src-tauri/gen/android/app/build.gradle.kts")
text = path.read_text(encoding="utf-8")
marker = "android {\n"

if marker not in text:
    raise SystemExit("generated app build.gradle.kts has no android block")

block = (
    "android {\n"
    "    packaging {\n"
    "        jniLibs {\n"
    "            useLegacyPackaging = true\n"
    "        }\n"
    "    }\n"
)

if "useLegacyPackaging = true" not in text:
    text = text.replace(marker, block, 1)
    path.write_text(text, encoding="utf-8")

updated = path.read_text(encoding="utf-8")
if "useLegacyPackaging = true" not in updated:
    raise SystemExit("native-library extraction packaging was not enabled")

print(updated[:3000])
