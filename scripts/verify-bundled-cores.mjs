import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = process.cwd()
const binaries = resolve(root, "src-tauri", "binaries")
const required = [
  ["aether-v1.3.0.exe", null],
  ["aether.exe", null],
  ["aether-version.txt", "v1.3.0"],
  ["sing-box-v1.13.14.exe", null],
  ["sing-box.exe", null],
  ["sing-box-version.txt", "v1.13.14"],
  ["wintun.dll", null],
]

const missing = required.filter(([name]) => !existsSync(resolve(binaries, name))).map(([name]) => name)
const incorrect = required
  .filter(([, expected]) => expected)
  .filter(([name, expected]) => readFileSync(resolve(binaries, name), "utf8").trim() !== expected)
  .map(([name, expected]) => `${name} must contain ${expected}`)

if (missing.length || incorrect.length) {
  throw new Error(`Bundled core verification failed: ${[...missing, ...incorrect].join(", ")}`)
}

console.log("Bundled Windows core runtime resources are present and match the pinned baselines.")
