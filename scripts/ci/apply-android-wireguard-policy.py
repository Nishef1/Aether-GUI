#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
SAFE_MASQUE_MARKER = "MASQUE transport selected: HTTP/2 (TCP); Android safe auto"


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected source block was not found")
    return text.replace(old, new, 1)


def replace_if_present(text: str, old: str, new: str) -> str:
    return text.replace(old, new, 1) if old in text else text


service = SERVICE.read_text(encoding="utf-8")

safe_selection = '''            val useMasqueHttp2 = AndroidTransportPolicy.isMasque(protocol) &&
                AndroidTransportPolicy.useMasqueHttp2(masqueHttp2, false)
            if (AndroidTransportPolicy.isMasque(protocol)) {
                log("MASQUE transport selected: HTTP/2 (TCP); Android safe auto")
            }
            val effectiveWgNoize = if (AndroidTransportPolicy.isWireGuardFamily(protocol)) {
                AndroidTransportPolicy.effectiveWireGuardNoize(wgNoize)
            } else {
                wgNoize
            }
            if (effectiveWgNoize != wgNoize) {
                log("Android stable dataplane pass: WireGuard noize $wgNoize -> $effectiveWgNoize")
            }

'''

legacy_selection = '''            val udpAvailable = if (AndroidTransportPolicy.isMasque(protocol) && !masqueHttp2) {
                AndroidUdpCapabilityProbe.hasUsableUdp()
            } else {
                true
            }
            val useMasqueHttp2 = AndroidTransportPolicy.isMasque(protocol) &&
                AndroidTransportPolicy.useMasqueHttp2(masqueHttp2, udpAvailable)
            if (AndroidTransportPolicy.isMasque(protocol)) {
                log(
                    "MASQUE transport selected: " +
                        if (useMasqueHttp2) {
                            "HTTP/2 (TCP); forceH2=$masqueHttp2; udpAvailable=$udpAvailable"
                        } else {
                            "HTTP/3 (QUIC); udpAvailable=$udpAvailable"
                        }
                )
            }
            val effectiveWgNoize = if (AndroidTransportPolicy.isWireGuardFamily(protocol)) {
                AndroidTransportPolicy.effectiveWireGuardNoize(wgNoize)
            } else {
                wgNoize
            }
            if (effectiveWgNoize != wgNoize) {
                log("Android stable dataplane pass: WireGuard noize $wgNoize -> $effectiveWgNoize")
            }

'''

if SAFE_MASQUE_MARKER not in service:
    if legacy_selection in service:
        service = service.replace(legacy_selection, safe_selection, 1)
    else:
        service = replace_required(
            service,
            "            val command = buildCoreCommand(\n",
            safe_selection + "            val command = buildCoreCommand(\n",
            "safe MASQUE H2 and WireGuard stable-pass selection",
        )

# Pass the resolved settings into CLI argument construction.
call_marker = '''                wgNoize = wgNoize,
            )
'''
call_marker_transport = '''                wgNoize = wgNoize,
                useMasqueHttp2 = useMasqueHttp2,
            )
'''
resolved_call = '''                wgNoize = effectiveWgNoize,
                useMasqueHttp2 = useMasqueHttp2,
            )
'''
if resolved_call not in service:
    if call_marker_transport in service:
        service = service.replace(call_marker_transport, resolved_call, 1)
    elif call_marker in service:
        service = service.replace(call_marker, resolved_call, 1)
    else:
        raise SystemExit("resolved transport command arguments were not found")

signature_marker = '''        wgNoize: String,
    ): List<String> {
'''
if "useMasqueHttp2: Boolean" not in service:
    service = replace_required(
        service,
        signature_marker,
        '''        wgNoize: String,
        useMasqueHttp2: Boolean,
    ): List<String> {
''',
        "buildCoreCommand transport parameter",
    )

old_env = '''            val processBuilder = ProcessBuilder(command).redirectErrorStream(true)
            processBuilder.environment().apply {
                put("AETHER_CONFIG", File(filesDir, "aether.toml").absolutePath)
                put("AETHER_MASQUE_HTTP2", if (masqueHttp2) "1" else "0")
                put("AETHER_LOG_LEVEL", "info")
                put("RUST_BACKTRACE", "1")
            }
'''
new_env = '''            val processBuilder = ProcessBuilder(command).redirectErrorStream(true)
            processBuilder.environment().apply {
                put("AETHER_CONFIG", File(filesDir, "aether.toml").absolutePath)
                remove("AETHER_MASQUE_HTTP2")
                if (AndroidTransportPolicy.isMasque(protocol) && useMasqueHttp2) {
                    put("AETHER_MASQUE_HTTP2", "1")
                }
                put("AETHER_LOG_LEVEL", "info")
                put("RUST_BACKTRACE", "1")
            }
'''
if old_env in service:
    service = service.replace(old_env, new_env, 1)
elif 'remove("AETHER_MASQUE_HTTP2")' not in service:
    raise SystemExit("MASQUE environment wiring: neither old nor new block was found")

fixed_timeout = '''            if (!waitForSocks(token, bindAddress, process, CORE_START_TIMEOUT_MS)) {
'''
old_policy_timeout = '''            val startupTimeoutMs = AndroidWireGuardPolicy.startupTimeoutMs(protocol, scanMode)
            log("Waiting up to ${startupTimeoutMs / 1000}s for $protocol SOCKS readiness")
            if (!waitForSocks(token, bindAddress, process, startupTimeoutMs)) {
'''
new_timeout = '''            val startupTimeoutMs = AndroidTransportPolicy.startupTimeoutMs(protocol, scanMode)
            log("Waiting up to ${startupTimeoutMs / 1000}s for $protocol SOCKS readiness")
            if (!waitForSocks(token, bindAddress, process, startupTimeoutMs)) {
'''
if fixed_timeout in service:
    service = service.replace(fixed_timeout, new_timeout, 1)
elif old_policy_timeout in service:
    service = service.replace(old_policy_timeout, new_timeout, 1)
elif new_timeout not in service:
    raise SystemExit("transport startup timeout wiring was not found")

# A listening local port is not a connected VPN. Verify remote DNS + TCP + HTTP
# through the exact SOCKS endpoint before creating TUN or publishing Connected.
verification_marker = '''            ensureActive(token)
            val connectedAt = System.currentTimeMillis()
'''
verification_block = '''            ensureActive(token)
            updateSnapshotIfActive(
                token,
                FinalServiceSnapshot(
                    state = "Verifying",
                    socksAddr = bindAddress,
                )
            )
            updateNotification("Verifying tunnel egress…")
            val initialProbe = AndroidEgressProbe.probe(bindAddress)
            ensureActive(token)
            AndroidVpnRuntime.publishProbe(
                initialProbe.publicIp,
                initialProbe.countryCode,
                initialProbe.latencyMs,
            )
            log(
                "SOCKS egress verified via ${initialProbe.provider}: ${initialProbe.publicIp}" +
                    (initialProbe.countryCode?.let { " · $it" } ?: "") +
                    " · ${initialProbe.latencyMs} ms"
            )
            val connectedAt = System.currentTimeMillis()
'''
if "SOCKS egress verified via ${initialProbe.provider}" not in service:
    service = replace_required(
        service,
        verification_marker,
        verification_block,
        "pre-TUN SOCKS egress verification",
    )

plain_return = '''        command += listOf(
            "--noize",
            if (protocol == "wireguard" || protocol == "gool") wgNoize else masqueNoize,
            "--bind",
            bindAddress,
            "--log-level",
            "info",
        )
        return command
'''
old_policy_return = '''        command += listOf(
            "--noize",
            if (protocol == "wireguard" || protocol == "gool") wgNoize else masqueNoize,
            "--bind",
            bindAddress,
            "--log-level",
            "info",
        )
        AndroidWireGuardPolicy.appendCoreArgs(command, protocol)
        return command
'''
new_policy_return = '''        command += listOf(
            "--noize",
            if (protocol == "wireguard" || protocol == "gool") wgNoize else masqueNoize,
            "--bind",
            bindAddress,
            "--log-level",
            "info",
        )
        AndroidTransportPolicy.appendCoreArgs(command, protocol, useMasqueHttp2)
        return command
'''
if plain_return in service:
    service = service.replace(plain_return, new_policy_return, 1)
elif old_policy_return in service:
    service = service.replace(old_policy_return, new_policy_return, 1)
elif new_policy_return not in service:
    raise SystemExit("transport runtime argument wiring was not found")

service = replace_if_present(
    service,
    '''        private const val CORE_START_TIMEOUT_MS = 50_000L
        private const val TUN_MTU = 8500
''',
    '''        private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU
''',
)
service = replace_if_present(
    service,
    '''        private const val TUN_MTU = AndroidWireGuardPolicy.TUN_MTU
''',
    '''        private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU
''',
)
if "private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU" not in service:
    raise SystemExit("Android transport MTU alignment was not applied")
if "CORE_START_TIMEOUT_MS" in service:
    raise SystemExit("fixed Android core startup timeout still exists")
if "AndroidUdpCapabilityProbe.hasUsableUdp()" in service:
    raise SystemExit("generic UDP probe still controls MASQUE transport")

SERVICE.write_text(service, encoding="utf-8")
print("Android safe MASQUE H2, stable WG pass, and egress gate applied successfully")
