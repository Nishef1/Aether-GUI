# Third-party notices

Aether-GUI bundles or prepares the following independent components. Their authors retain their respective copyrights and licenses.

## Aether

- Project: CluvexStudio/Aether
- Role: censorship-circumvention transport and local SOCKS5 server
- License: GNU Affero General Public License v3.0
- Source: https://github.com/CluvexStudio/Aether

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

The Windows preparation script verifies the official archive checksum and the DLL Authenticode signer. It also copies the license supplied in the official prebuilt archive to `binaries/wintun-LICENSE.txt`, which is bundled beside `wintun.dll`.

## HEV SOCKS5 tunnel

Android builds may include HEV SOCKS5 tunnel as the VpnService TUN-to-SOCKS dataplane. Its notice and exact pinned version must be added with the Android module before an Android release is published.

This file is informational. The complete license texts distributed with third-party binaries remain authoritative.
