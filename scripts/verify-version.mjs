import { readFileSync } from "node:fs"

const json = JSON.parse(readFileSync("package.json", "utf8"))
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version
const values = [json.version, cargo, tauri]
if (!values.every((value) => value === values[0])) throw new Error(`Version declarations differ: ${values.join(", ")}`)
const tag = process.env.GITHUB_REF_NAME
if (tag && tag !== `v${values[0]}`) throw new Error(`Release tag ${tag} must match application version v${values[0]}`)
console.log(`Aether-GUI version ${values[0]} is synchronized.`)
