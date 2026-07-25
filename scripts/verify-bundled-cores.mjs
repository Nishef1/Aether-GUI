import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"

const root = process.cwd()
const binaries = resolve(root, "src-tauri", "binaries")
const embeddedAether = resolve(root, "vendor", "aether")

let embeddedAetherCommit = ""
let embeddedAetherDirtyState = ""
try {
  embeddedAetherCommit = execFileSync(
    "git",
    ["-C", embeddedAether, "rev-parse", "--short=12", "HEAD"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim()
  embeddedAetherDirtyState = execFileSync(
    "git",
    ["-C", embeddedAether, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim()
} catch (error) {
  throw new Error(
    `Could not inspect the pinned vendor/aether source: ${error instanceof Error ? error.message : String(error)}`
  )
}

if (!/^[0-9a-f]{12}$/i.test(embeddedAetherCommit)) {
  throw new Error(`Invalid embedded Aether commit identifier: ${embeddedAetherCommit}`)
}
if (embeddedAetherDirtyState) {
  throw new Error(
    "vendor/aether contains uncommitted changes; a distributable installer must match the committed submodule pointer exactly"
  )
}

const expectedAetherVersion = `dev-${embeddedAetherCommit}`
const safeAetherVersion = expectedAetherVersion.replace(/[^A-Za-z0-9._-]/g, "_")
const versionedAetherBinary = `aether-${safeAetherVersion}.exe`

const required = [
  [versionedAetherBinary, null],
  ["aether.exe", null],
  ["aether-version.txt", expectedAetherVersion],
  ["sing-box-v1.13.14.exe", null],
  ["sing-box.exe", null],
  ["sing-box-version.txt", "v1.13.14"],
  ["xray-v26.6.1.exe", null],
  ["xray.exe", null],
  ["xray-version.txt", "v26.6.1"],
  ["wintun.dll", null],
  ["fetch-aether.ps1", null],
  ["fetch-singbox.ps1", null],
  ["fetch-xray.ps1", null],
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
  existsSync(filePath(versionedAetherBinary)) &&
  existsSync(filePath("aether.exe")) &&
  sha256(versionedAetherBinary) !== sha256("aether.exe")
) {
  aliasMismatches.push(`aether.exe must exactly match ${versionedAetherBinary}`)
}
if (
  existsSync(filePath("sing-box-v1.13.14.exe")) &&
  existsSync(filePath("sing-box.exe")) &&
  sha256("sing-box-v1.13.14.exe") !== sha256("sing-box.exe")
) {
  aliasMismatches.push("sing-box.exe must exactly match sing-box-v1.13.14.exe")
}
if (
  existsSync(filePath("xray-v26.6.1.exe")) &&
  existsSync(filePath("xray.exe")) &&
  sha256("xray-v26.6.1.exe") !== sha256("xray.exe")
) {
  aliasMismatches.push("xray.exe must exactly match xray-v26.6.1.exe")
}

const staleAetherCopies = existsSync(binaries)
  ? readdirSync(binaries)
      .filter((name) => /^aether-.*\.exe$/i.test(name))
      .filter((name) => name !== versionedAetherBinary)
      .map((name) => `stale bundled Aether binary must be removed: ${name}`)
  : []

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
  ...staleAetherCopies,
  ...invalidMappings,
]

if (failures.length) {
  throw new Error(`Bundled core verification failed: ${failures.join(", ")}`)
}

console.log(
  `Bundled Windows Aether ${expectedAetherVersion} matches clean vendor/aether ${embeddedAetherCommit}; sing-box, Xray, Wintun, installer helpers, aliases, and Tauri resource mappings match the pinned release contract.`
)
