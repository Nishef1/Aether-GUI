import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src-tauri", "icons", "128x128@2x.png");
const target = path.join(root, "src-tauri", "icons", "icon.png");

if (!fs.existsSync(source)) {
  throw new Error(`Canonical Aether icon is missing: ${source}`);
}

const sourceBytes = fs.readFileSync(source);
const targetMatches =
  fs.existsSync(target) && fs.readFileSync(target).equals(sourceBytes);

if (!targetMatches) {
  fs.copyFileSync(source, target);
  console.log("Prepared canonical icon.png from the Windows Aether artwork");
}
