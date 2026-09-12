# VPN detectability threat model

Aether should reduce accidental VPN/proxy signals without pretending that a tunneled connection can be made indistinguishable from a normal residential connection in every case.

The working threat model is based in part on the public detection research and live-test documentation from Incolumitas / ProxyDetect:

- https://incolumitas.com/2021/10/16/7-different-ways-to-detect-proxies/
- https://incolumitas.com/2021/03/13/tcp-ip-fingerprinting-for-vpn-and-proxy-detection/
- https://incolumitas.com/2021/06/07/detecting-proxies-and-vpn-with-latencies/
- https://proxydetect.live/
- https://proxydetect.live/tcpip.html
- https://proxydetect.live/latency.html
- https://proxydetect.live/ai.html

## Signals Aether can reduce

### DNS leaks and resolver mismatch

DNS must stay on the protected data path. Desktop full-device mode hijacks DNS and sends configured resolvers through the Aether SOCKS path; Android VpnService installs the same resolver identity used by Core. Default DNS uses public generic resolvers, and the optional filtering profile uses AdGuard DNS.

A resolver configuration that is malformed must fail before the VPN is announced healthy.

### WebRTC leaks

Full-device mode is the product default. UDP/STUN must stay inside the VPN path rather than bypassing a browser-level proxy. Proxy-only mode cannot make the same guarantee and should not be described as leak-safe.

### HTTP proxy headers

Aether's normal full-device path is L3/TUN -> SOCKS -> tunnel and does not inject forwarding headers such as `Forwarded`, `Via`, `X-Forwarded-For`, or `X-Real-IP`. The optional local HTTP CONNECT listener must remain loopback-only by default and must not add identity headers.

### Avoidable latency and flow overhead

Do not add artificial post-connect latency, packet jitter, or padding merely to look random. Passive detection systems compare TCP/IP timing with browser/WebSocket timing, so gratuitous delay can make a tunnel easier to classify.

Automatic mode therefore prefers single-hop transports before nested Warp-in-Warp:

1. MASQUE H2
2. WireGuard
3. MASQUE H3
4. Warp-in-Warp

Historical success may reorder the single-hop fallbacks, but must never promote Warp-in-Warp ahead of a single-hop fallback. Explicit manual Warp-in-Warp remains available for reachability.

### Gateway selection

For Balanced/Thorough/Ironclad, choose among verified candidates using real RTT/data-plane evidence rather than adding camouflage delay. Turbo remains first-healthy by design because connection time is its primary contract.

## Signals Aether should preserve instead of spoof

### TCP/IP fingerprint

ProxyDetect's passive classifier considers SYN/TCP fields such as MSS, window size/scale, TCP options, TTL, flags, packet sizes and inter-arrival timing. Aether must not blindly rewrite these fields just to imitate another OS. If a route already produces a clean fingerprint, changing it creates a new inconsistency with the user's real browser/device.

Tunnel MTU should be chosen for transport correctness. In particular, nested tunnels have real encapsulation overhead; advertising an unrealistically large MSS simply to evade a detector can cause fragmentation, black holes, or worse performance.

### Browser/device timezone

A VPN client cannot safely falsify the timezone reported by arbitrary browsers and apps. The only robust mitigation is to use an exit whose geolocation is reasonably consistent with the user's intended locale, or let the user align the device/browser timezone themselves. Aether must not silently change the operating-system timezone.

## Signals Aether cannot remove with transport obfuscation

### Hosting-provider / ASN classification

If the public exit IP belongs to Cloudflare, a datacenter, or another hosting network, a remote service can classify the ASN/IP range regardless of how the client reaches that exit.

### Known proxy/VPN lists and exit enumeration

MASK, TLS profile selection, H2/H3 choice, fragmentation and Noize affect the client-to-edge path. They do not change the public exit IP seen by the destination. A known WARP/VPN exit can therefore remain listed even when the tunnel itself is otherwise clean.

Avoid claims such as "undetectable VPN". The accurate goal is lower leakage, lower avoidable latency, internally consistent fingerprints, and the smallest practical detection surface compatible with reachability.

## Mode semantics

- **Turbo**: fastest first-healthy route. No artificial post-connect jitter.
- **Balanced**: compare more candidates and favor lower RTT/healthier paths.
- **Thorough**: wider discovery; not a website-anonymity mode.
- **Stealth**: quieter *pre-connect discovery* toward the access network. It does not hide the final exit, browser timezone, or destination-visible TCP/IP behavior.
- **Ironclad**: stronger real data-plane validation. It verifies that a path works; it does not make the path invisible.

## Regression rules

1. DNS and WebRTC must not bypass full-device protection.
2. Do not inject proxy-identifying HTTP headers.
3. Do not add post-connect random latency as an anti-detection technique.
4. Automatic mode keeps nested Warp-in-Warp after all single-hop fallbacks.
5. Do not silently rewrite system timezone or browser identity.
6. Do not claim that transport obfuscation can hide a known VPN/datacenter exit IP.
