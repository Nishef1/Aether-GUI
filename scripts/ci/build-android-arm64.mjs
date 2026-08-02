import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const androidRoot = path.join(root, "src-tauri", "gen", "android")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

if (!existsSync(path.join(androidRoot, "app", "build.gradle.kts"))) {
  throw new Error(
    "Generated Android project is missing; run npm run android:init first"
  )
}

const result = spawnSync(
  npm,
  [
    "run",
    "tauri",
    "--",
    "android",
    "build",
    "--apk",
    "--split-per-abi",
    "--target",
    "aarch64",
    "--ci",
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

function findApks(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry)
    if (statSync(fullPath).isDirectory()) files.push(...findApks(fullPath))
    else if (/\.apk$/i.test(entry)) files.push(fullPath)
  }
  return files
}

const apks = findApks(
  path.join(androidRoot, "app", "build", "outputs", "apk")
).filter((file) => !/debug|unsigned/i.test(path.basename(file)))
if (apks.length !== 1) {
  throw new Error(
    `Expected exactly one ARM64 release APK, found ${apks.length}`
  )
}
if (/universal/i.test(apks[0])) {
  throw new Error(
    `Universal APK was produced instead of split ARM64 APK: ${apks[0]}`
  )
}
console.log(`Built ${path.relative(root, apks[0])}`)
