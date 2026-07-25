# Android ARM64 build

Aether-GUI includes a manual GitHub Actions workflow that builds a directly installable `arm64-v8a` debug APK. No Android Studio, emulator, SDK, NDK, Java, or Rust Android target is required on the user's computer.

## Requirements

- ARM64 (`arm64-v8a`) phone or tablet
- Android 10 / API 29 or newer
- permission to install an APK from the selected browser or file manager
- Android VPN permission for **Tunnel** and **Both** modes

## Build

1. Open **Actions** in the `Aether-GUI` repository.
2. Select **Build Android ARM64 APK**.
3. Choose **Run workflow** on `main`.
4. After the run succeeds, download the `Aether-Android-arm64-v8a` artifact.
5. Extract the ZIP and install the APK on an ARM64 Android device.

The artifact also contains `SHA256SUMS.txt`, `NATIVE_SOURCES.txt`, and the third-party license notice.

## Architecture

The build uses:

- the existing React interface;
- Tauri 2's Android host;
- a Kotlin plugin and foreground `VpnService` lifecycle;
- the pinned `vendor/aether` submodule compiled for `aarch64-linux-android`;
- an ARM64 Aether executable packaged as `libaether_exec.so`;
- `hev-socks5-tunnel` 2.14.3 pinned to commit `da33382c7282b4e764408535704f3cd96fea9a14`, compiled as `libhev-socks5-tunnel.so` with the app-specific JNI package and class names.

The service starts Aether as a private loopback SOCKS5 endpoint. For full-device modes, Android creates the TUN file descriptor and the native bridge forwards IPv4, IPv6, TCP, UDP, and DNS traffic to that endpoint.

Aether runs under the application's UID. The VPN builder excludes the Aether application package itself, so the core's gateway sockets bypass the VPN and cannot loop back into its own TUN interface. Other applications remain routed through the tunnel.

## Connection modes

- **Proxy:** starts only the protected loopback SOCKS5 endpoint.
- **Tunnel:** routes device traffic through Android `VpnService` and Aether.
- **Both:** keeps the local SOCKS5 endpoint available while the system tunnel is active.

The first Tunnel/Both connection opens Android's standard VPN-consent screen. Denying that consent leaves the app disconnected and does not change device routes.

## Diagnostics

The Android service keeps bounded Aether logs and a separate native TUN bridge log under the app's private data directory. TUN traffic counters are read directly from the native bridge and surfaced through the existing GUI traffic model.

## Testing

Use a physical ARM64 phone. Validate at minimum:

- first launch and WebView rendering;
- VPN consent acceptance and denial;
- Proxy, Tunnel, and Both independently;
- foreground notification behavior;
- start, stop, and repeated reconnect lifecycle;
- MASQUE HTTP/2 and HTTP/3 separately;
- switching Wi-Fi to mobile data;
- app backgrounding and process recreation;
- IPv4, IPv6, TCP, UDP, and DNS behavior;
- diagnostics after failed enrollment or gateway probing;
- no connectivity leak or route loop after disconnect.

The workflow intentionally runs only through `workflow_dispatch`; it does not build on every push.
