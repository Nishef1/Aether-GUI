import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const expectedCertificate =
  "AA:5D:45:F0:12:4A:61:E7:5B:3D:66:04:5F:6A:18:96:0D:3B:33:5E:73:5B:33:96:EF:9C:1C:04:72:E8:9F:7B"
const expectedAbis = new Set(["arm64-v8a"])
const expectedLibraries = new Set([
  "lib/arm64-v8a/libaether_exec.so",
  "lib/arm64-v8a/libaethertun.so",
  "lib/arm64-v8a/libhev-socks5-tunnel.so",
])
const apk = process.argv[2] ? path.resolve(process.argv[2]) : ""

function fail(message) {
  throw new Error(`Android release verification failed: ${message}`)
}

if (!apk || !existsSync(apk) || !statSync(apk).isFile())
  fail("APK path does not exist")
if (path.basename(apk).toLowerCase().includes("unsigned"))
  fail("release APK filename contains unsigned")

function command(commandName, args) {
  const result = spawnSync(commandName, args, {
    encoding: "utf8",
    shell: process.platform === "win32" && /\.(bat|cmd)$/i.test(commandName),
  })
  if (result.error) return null
  return result.status === 0 ? `${result.stdout}\n${result.stderr}` : null
}

function findApksigner() {
  const candidates = []
  if (process.env.APKSIGNER) candidates.push(process.env.APKSIGNER)
  for (const sdk of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (!sdk) continue
    const buildTools = path.join(sdk, "build-tools")
    if (!existsSync(buildTools)) continue
    for (const version of readdirSync(buildTools).sort().reverse()) {
      candidates.push(
        path.join(
          buildTools,
          version,
          process.platform === "win32" ? "apksigner.bat" : "apksigner"
        )
      )
    }
  }
  candidates.push("apksigner")
  return candidates.find(
    (candidate) => candidate === "apksigner" || existsSync(candidate)
  )
}

const apksigner = findApksigner()
if (!apksigner) fail("Android build-tools apksigner was not found")
const signature = command(apksigner, [
  "verify",
  "--verbose",
  "--print-certs",
  apk,
])
if (!signature) fail("apksigner verification failed")
for (const scheme of ["v1", "v2", "v3"]) {
  const match = new RegExp(
    `Verified using ${scheme} scheme[^:]*:\\s*true`,
    "i"
  ).test(signature)
  if (!match) fail(`APK Signature Scheme ${scheme} is not valid`)
}
const signerCount = signature.match(/Number of signers:\s*(\d+)/i)
if (!signerCount || signerCount[1] !== "1")
  fail("APK does not have exactly one signer")
const certificateMatch = signature.match(
  /certificate SHA-256 digest:\s*([0-9A-F:]+)/i
)
if (!certificateMatch)
  fail("signer certificate SHA-256 fingerprint was not reported")
const certificate = certificateMatch[1].toUpperCase()
if (certificate !== expectedCertificate)
  fail(`unexpected signer certificate SHA-256 fingerprint (${certificate})`)

function readZipEntries() {
  const script = [
    "import json, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as archive:",
    "    print(json.dumps(archive.namelist()))",
  ].join("\n")
  for (const python of process.platform === "win32"
    ? ["python", "python3"]
    : ["python3", "python"]) {
    const result = spawnSync(python, ["-c", script, apk], { encoding: "utf8" })
    if (!result.error && result.status === 0) return JSON.parse(result.stdout)
  }
  fail(
    "Python with the standard zipfile module was not found for APK inspection"
  )
}

const entries = readZipEntries()
const abis = new Set(
  entries
    .filter((entry) => entry.startsWith("lib/"))
    .map((entry) => entry.split("/")[1])
    .filter(Boolean)
)
if (
  abis.size !== expectedAbis.size ||
  [...expectedAbis].some((abi) => !abis.has(abi))
) {
  fail(
    `unexpected APK ABI directories: ${[...abis].sort().join(", ") || "none"}`
  )
}
for (const library of expectedLibraries) {
  if (!entries.includes(library))
    fail(`expected native library is missing: ${library}`)
}

console.log(`Verified signed ARM64 APK: ${path.basename(apk)}`)
console.log(`Certificate SHA-256: ${certificate}`)
console.log(`APK ABIs: ${[...abis].sort().join(", ")}`)
console.log(`Native libraries: ${[...expectedLibraries].sort().join(", ")}`)
