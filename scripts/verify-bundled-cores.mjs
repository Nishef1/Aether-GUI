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
  ["fetch-aether.ps1", null],
  ["fetch-singbox.ps1", null],
]

const missing = required
  .filter(([name]) => !existsSync(resolve(binaries, name)))
  .map(([name]) => name)
const incorrect = required
  .filter(([, expected]) => expected)
  .filter(
    ([name, expected]) =>
      readFileSync(resolve(binaries, name), "utf8").trim() !== expected
  )
  .map(([name, expected]) => `${name} must contain ${expected}`)

const tauriConfig = JSON.parse(
  readFileSync(resolve(root, "src-tauri", "tauri.conf.json"), "utf8")
)
const resources = tauriConfig?.bundle?.resources
const requiredResourceMappings = {
  "binaries/*.exe": "binaries/",
  "binaries/*.dll": "binaries/",
  "binaries/*-version.txt": "binaries/",
  "binaries/*.ps1": "binaries/",
}
const invalidMappings = Object.entries(requiredResourceMappings)
  .filter(([source, destination]) => resources?.[source] !== destination)
  .map(
    ([source, destination]) =>
      `tauri bundle.resources must map ${source} to ${destination}`
  )

if (missing.length || incorrect.length || invalidMappings.length) {
  throw new Error(
    `Bundled core verification failed: ${[
      ...missing,
      ...incorrect,
      ...invalidMappings,
    ].join(", ")}`
  )
}

console.log(
  "Bundled Windows core runtime resources, installer helpers, and Tauri resource mappings match the pinned release contract."
)
