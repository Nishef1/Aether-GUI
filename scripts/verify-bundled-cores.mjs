import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
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

const filePath = (name) => resolve(binaries, name)
const missing = required
  .filter(([name]) => !existsSync(filePath(name)))
  .map(([name]) => name)
const empty = required
  .filter(([name]) => existsSync(filePath(name)))
  .filter(([name]) => statSync(filePath(name)).size <= 0)
  .map(([name]) => `${name} must not be empty`)
const incorrect = required
  .filter(([, expected]) => expected)
  .filter(
    ([name, expected]) =>
      existsSync(filePath(name)) &&
      readFileSync(filePath(name), "utf8").trim() !== expected
  )
  .map(([name, expected]) => `${name} must contain ${expected}`)

const sha256 = (name) =>
  createHash("sha256").update(readFileSync(filePath(name))).digest("hex")

const aliasMismatches = []
if (
  existsSync(filePath("aether-v1.3.0.exe")) &&
  existsSync(filePath("aether.exe")) &&
  sha256("aether-v1.3.0.exe") !== sha256("aether.exe")
) {
  aliasMismatches.push("aether.exe must exactly match aether-v1.3.0.exe")
}
if (
  existsSync(filePath("sing-box-v1.13.14.exe")) &&
  existsSync(filePath("sing-box.exe")) &&
  sha256("sing-box-v1.13.14.exe") !== sha256("sing-box.exe")
) {
  aliasMismatches.push("sing-box.exe must exactly match sing-box-v1.13.14.exe")
}

const optionalCronet = filePath("libcronet.dll")
if (existsSync(optionalCronet) && statSync(optionalCronet).size <= 0) {
  empty.push("libcronet.dll must not be empty when present")
}

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

const failures = [
  ...missing,
  ...empty,
  ...incorrect,
  ...aliasMismatches,
  ...invalidMappings,
]

if (failures.length) {
  throw new Error(`Bundled core verification failed: ${failures.join(", ")}`)
}

console.log(
  "Bundled Windows core runtime resources, installer helpers, fallback aliases, and Tauri resource mappings match the pinned release contract."
)