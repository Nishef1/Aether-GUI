# Third-party notices

Aether-GUI bundles or prepares the following independent components. Their authors retain their respective copyrights and licenses.

## Aether

- Project: CluvexStudio/Aether
- Role: censorship-circumvention transport and local SOCKS5 server
- Desktop and Android baseline: v1.5.0 (`66a798b7771d5ffbb28fc858bffc99fb67295baf`)
- License: GNU Affero General Public License v3.0
- Source: https://github.com/CluvexStudio/Aether

The Android preparation script downloads the official ARM64 release asset, verifies the release-provided SHA-256 digest and bundles the corresponding license text.

## sing-box

- Project: SagerNet/sing-box
- Role: optional desktop system-wide TUN sidecar over Aether's SOCKS5 endpoint
- Pinned release: v1.13.12
- License: GNU General Public License v3.0 or later
- Source: https://github.com/SagerNet/sing-box

The preparation scripts copy the license file distributed in the verified sing-box release archive to `binaries/sing-box-LICENSE.txt`, which is bundled beside the executable.

## Wintun

- Project: WireGuard/Wintun
- Role: Windows layer-3 TUN driver used by the optional sing-box sidecar
- Pinned package: 0.14.1
- Source: https://www.wintun.net/

The Windows preparation script verifies the official archive checksum and the DLL Authenticode signer. It also copies the license supplied in the official prebuilt archive to `binaries/wintun-LICENSE.txt`.

## HEV SOCKS5 tunnel

- Project: heiher/hev-socks5-tunnel
- Role: Android `VpnService` TUN-to-SOCKS dataplane
- Pinned release: 2.14.4
- Source: https://github.com/heiher/hev-socks5-tunnel

The Android builder compiles the pinned tag for ARM64, verifies the stable native API symbols used by the local JNI wrapper and bundles the upstream license beside the native assets.

This file is informational. The complete license texts distributed with third-party binaries remain authoritative.
