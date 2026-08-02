import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const androidRoot = path.join(root, "src-tauri", "gen", "android")
const gradlePath = path.join(androidRoot, "app", "build.gradle.kts")
const propertiesPath = path.join(androidRoot, "keystore.properties")
const signingProperties = [
  "ANDROID_KEYSTORE_BASE64",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_PASSWORD",
]

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required Android release signing secret: ${name}`)
  }
  return value
}

function propertyValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(/\r?\n/g, "")
}

for (const name of signingProperties) required(name)
if (!existsSync(gradlePath)) {
  throw new Error(
    "Generated Android project is missing app/build.gradle.kts; run npm run android:init first"
  )
}

const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir()
const keystorePath = path.join(runnerTemp, "aether-gui-android-release.jks")
const keystoreBytes = Buffer.from(
  required("ANDROID_KEYSTORE_BASE64").replaceAll(/\s+/g, ""),
  "base64"
)
if (keystoreBytes.length < 1024) {
  throw new Error(
    "ANDROID_KEYSTORE_BASE64 did not decode to a valid Android keystore-sized file"
  )
}
writeFileSync(keystorePath, keystoreBytes, { mode: 0o600 })
try {
  chmodSync(keystorePath, 0o600)
} catch {
  // Windows does not expose POSIX file modes; the file is still kept outside the repository.
}

const properties =
  [
    `storeFile=${propertyValue(keystorePath)}`,
    `storePassword=${propertyValue(required("ANDROID_KEYSTORE_PASSWORD"))}`,
    `keyAlias=${propertyValue(required("ANDROID_KEY_ALIAS"))}`,
    `keyPassword=${propertyValue(required("ANDROID_KEY_PASSWORD"))}`,
  ].join(os.EOL) + os.EOL
writeFileSync(propertiesPath, properties, { mode: 0o600 })
try {
  chmodSync(propertiesPath, 0o600)
} catch {
  // Windows does not expose POSIX file modes.
}

let gradle = readFileSync(gradlePath, "utf8").replaceAll("\r\n", "\n")
const marker = "// Aether permanent release signing"
if (!gradle.includes(marker)) {
  gradle = gradle.replace(
    "import java.util.Properties\n",
    "import java.util.Properties\nimport org.gradle.api.GradleException\n"
  )
  const config = `${marker}
val aetherReleaseSigningProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.isFile) {
        propFile.inputStream().use { load(it) }
    }
}
val aetherReleaseSigningComplete = listOf(
    "storeFile",
    "storePassword",
    "keyAlias",
    "keyPassword",
).all { !aetherReleaseSigningProperties.getProperty(it).isNullOrBlank() }

`
  gradle = gradle.replace("android {\n", `${config}android {\n`)
  gradle = gradle.replace(
    "android {\n",
    `android {
    signingConfigs {
        if (aetherReleaseSigningComplete) {
            create("aetherPermanentRelease") {
                storeFile = file(aetherReleaseSigningProperties.getProperty("storeFile"))
                storePassword = aetherReleaseSigningProperties.getProperty("storePassword")
                keyAlias = aetherReleaseSigningProperties.getProperty("keyAlias")
                keyPassword = aetherReleaseSigningProperties.getProperty("keyPassword")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }
`
  )
  gradle = gradle.replace(
    '        getByName("release") {\n',
    `        getByName("release") {
            if (!aetherReleaseSigningComplete) {
                throw GradleException("Android release signing is not configured")
            }
            signingConfig = signingConfigs.getByName("aetherPermanentRelease")
`
  )
  writeFileSync(gradlePath, gradle)
}

const gradlePropertiesPath = path.join(androidRoot, "gradle.properties")
let gradleProperties = readFileSync(gradlePropertiesPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => !/^(abiList|archList|targetList)=/.test(line))
  .join(os.EOL)
  .replace(new RegExp(`${marker}\\r?\\n?`, "g"), "")
  .trimEnd()
gradleProperties += `${os.EOL}${os.EOL}${marker}${os.EOL}abiList=arm64-v8a${os.EOL}archList=arm64${os.EOL}targetList=aarch64${os.EOL}`
writeFileSync(gradlePropertiesPath, gradleProperties)

console.log(
  "Configured temporary Android ARM64 release signing and Gradle ABI constraints"
)
