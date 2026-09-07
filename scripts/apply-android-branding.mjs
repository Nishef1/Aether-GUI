import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src-tauri", "icons", "icon.png");
const appMain = path.join(root, "src-tauri", "gen", "android", "app", "src", "main");
const resRoot = path.join(appMain, "res");
const manifestPath = path.join(appMain, "AndroidManifest.xml");

if (!fs.existsSync(source)) {
  throw new Error("Canonical icon.png is missing; run npm run prepare:app-icon first");
}
if (!fs.existsSync(resRoot)) {
  throw new Error("Generated Android resources are missing; run npm run android:init first");
}

for (const entry of fs.readdirSync(resRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("mipmap")) continue;
  const directory = path.join(resRoot, entry.name);
  for (const name of fs.readdirSync(directory)) {
    if (/^ic_launcher(?:_round|_foreground|_background)?\./.test(name)) {
      fs.rmSync(path.join(directory, name), { force: true });
    }
  }
}

const drawableNoDpi = path.join(resRoot, "drawable-nodpi");
const drawable = path.join(resRoot, "drawable");
const mipmapNoDpi = path.join(resRoot, "mipmap-nodpi");
const mipmapAnyDpiV26 = path.join(resRoot, "mipmap-anydpi-v26");
const values = path.join(resRoot, "values");
for (const directory of [drawableNoDpi, drawable, mipmapNoDpi, mipmapAnyDpiV26, values]) {
  fs.mkdirSync(directory, { recursive: true });
}

fs.copyFileSync(source, path.join(drawableNoDpi, "aether_launcher_mark.png"));
fs.copyFileSync(source, path.join(mipmapNoDpi, "ic_launcher.png"));
fs.copyFileSync(source, path.join(mipmapNoDpi, "ic_launcher_round.png"));

fs.writeFileSync(
  path.join(drawable, "aether_launcher_foreground.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item
        android:left="18dp"
        android:top="18dp"
        android:right="18dp"
        android:bottom="18dp">
        <bitmap
            android:src="@drawable/aether_launcher_mark"
            android:gravity="fill" />
    </item>
</layer-list>
`,
);

const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/aether_launcher_background" />
    <foreground android:drawable="@drawable/aether_launcher_foreground" />
</adaptive-icon>
`;
fs.writeFileSync(path.join(mipmapAnyDpiV26, "ic_launcher.xml"), adaptiveIcon);
fs.writeFileSync(path.join(mipmapAnyDpiV26, "ic_launcher_round.xml"), adaptiveIcon);
fs.writeFileSync(
  path.join(values, "aether_launcher_colors.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="aether_launcher_background">#0D0D0F</color>
</resources>
`,
);

// Tauri regenerates this manifest during `android init`, so apply the keyboard
// behavior here rather than hand-editing generated sources. Android's current
// edge-to-edge guidance requires interactive content to react to IME/system
// insets; adjustResize lets the WebView viewport shrink when expert text fields
// open the software keyboard instead of hiding controls below it.
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, "utf8");
  const activityPattern = /<activity\b[\s\S]*?android:name="[^"]*MainActivity"[\s\S]*?>/;
  const match = manifest.match(activityPattern)?.[0];
  if (!match) {
    throw new Error("Generated Android MainActivity was not found in AndroidManifest.xml");
  }
  let patched = match;
  if (/android:windowSoftInputMode="[^"]*"/.test(patched)) {
    patched = patched.replace(
      /android:windowSoftInputMode="[^"]*"/,
      'android:windowSoftInputMode="adjustResize"',
    );
  } else {
    patched = patched.replace(/>$/, '\n            android:windowSoftInputMode="adjustResize">');
  }
  manifest = manifest.replace(match, patched);
  fs.writeFileSync(manifestPath, manifest);
}

console.log("Applied Android launcher branding and mobile window behavior");
