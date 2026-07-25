# Android ARM64 build

Aether-GUI includes a manual GitHub Actions workflow that builds a directly installable `arm64-v8a` debug APK. No Android Studio, emulator, SDK, NDK, Java, or Rust Android target is required on the user's computer.

## Build

1. Open **Actions** in the `Aether-GUI` repository.
2. Select **Build Android ARM64 APK**.
3. Choose **Run workflow** on `main`.
4. After the run succeeds, download the `Aether-Android-arm64-v8a` artifact.
5. Extract the ZIP and install the APK on an ARM64 Android device.

The artifact also contains `SHA256SUMS.txt`.

## Architecture

The build uses:

- the existing React interface;
- Tauri 2's Android host;
- a native Kotlin plugin and foreground `VpnService` lifecycle;
- the pinned `vendor/aether` submodule compiled for `aarch64-linux-android`;
- an ARM64 Aether executable packaged as `libaether_exec.so` so Android extracts it into the app's executable native-library directory.

The service starts Aether as a private local SOCKS5 endpoint and records bounded diagnostics inside the application data directory.

## Current alpha boundary

The first ARM64 build deliberately supports **Proxy mode only**.

Aether itself currently exposes the protected SOCKS5 path. On desktop, Xray or sing-box owns the system-wide TUN routing. Android requires a validated TUN-to-SOCKS data plane attached to the file descriptor created by `VpnService.Builder.establish()`.

Until that bridge is integrated and tested on a physical device, **Tunnel** and **Both** stay disabled. This prevents an incomplete VPN route from capturing all device traffic and leaving the phone without working connectivity.

## Testing

Use a physical ARM64 phone. Validate at minimum:

- first launch and WebView rendering;
- foreground notification behavior;
- start and stop lifecycle;
- MASQUE HTTP/2 and HTTP/3 separately;
- switching Wi-Fi to mobile data;
- app backgrounding and process recreation;
- diagnostics after failed enrollment or gateway probing;
- SOCKS endpoint reachability from a compatible Android client.

The current workflow intentionally runs only through `workflow_dispatch`; it does not build on every push.
