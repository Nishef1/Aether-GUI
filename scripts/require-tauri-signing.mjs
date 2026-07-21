if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error("TAURI_SIGNING_PRIVATE_KEY is required for a production updater release. Use build:windows:setup:unsigned only for local non-updater testing.")
}
console.log("Tauri updater signing key is configured.")
