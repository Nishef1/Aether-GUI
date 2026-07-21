if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  throw new Error("Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH for a production updater release. Use build:windows:setup:unsigned only for local non-updater testing.")
}
console.log("Tauri updater signing key is configured.")
