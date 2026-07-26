#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected source block was not found")
    return text.replace(old, new, 1)


def replace_if_present(text: str, old: str, new: str) -> str:
    return text.replace(old, new, 1) if old in text else text


service = SERVICE.read_text(encoding="utf-8")

# Compute the real MASQUE transport before the process is launched. False in the
# UI means Auto; it must not be serialized as AETHER_MASQUE_HTTP2=0 because the
# core treats the mere presence of that variable as an explicit choice.
if "val udpAvailable = if (AndroidTransportPolicy.isMasque(protocol)" not in service:
    service = replace_required(
        service,
        """            val command = buildCoreCommand(\n""",
        """            val udpAvailable = if (AndroidTransportPolicy.isMasque(protocol) && !masqueHttp2) {\n                AndroidUdpCapabilityProbe.hasUsableUdp()\n            } else {\n                true\n            }\n            val useMasqueHttp2 = AndroidTransportPolicy.isMasque(protocol) &&\n                AndroidTransportPolicy.useMasqueHttp2(masqueHttp2, udpAvailable)\n            if (AndroidTransportPolicy.isMasque(protocol)) {\n                log(\n                    \"MASQUE transport selected: \" +\n                        if (useMasqueHttp2) {\n                            \"HTTP/2 (TCP); forceH2=$masqueHttp2; udpAvailable=$udpAvailable\"\n                        } else {\n                            \"HTTP/3 (QUIC); udpAvailable=$udpAvailable\"\n                        }\n                )\n            }\n            val effectiveWgNoize = if (AndroidTransportPolicy.isWireGuardFamily(protocol)) {\n                AndroidTransportPolicy.effectiveWireGuardNoize(wgNoize)\n            } else {\n                wgNoize\n            }\n            if (effectiveWgNoize != wgNoize) {\n                log(\"Android stable dataplane pass: WireGuard noize $wgNoize -> $effectiveWgNoize\")\n            }\n\n            val command = buildCoreCommand(\n""",
        "MASQUE transport and WireGuard stable-pass selection",
    )
elif "val effectiveWgNoize = if (AndroidTransportPolicy.isWireGuardFamily(protocol))" not in service:
    service = replace_required(
        service,
        """\n            val command = buildCoreCommand(\n""",
        """\n            val effectiveWgNoize = if (AndroidTransportPolicy.isWireGuardFamily(protocol)) {\n                AndroidTransportPolicy.effectiveWireGuardNoize(wgNoize)\n            } else {\n                wgNoize\n            }\n            if (effectiveWgNoize != wgNoize) {\n                log(\"Android stable dataplane pass: WireGuard noize $wgNoize -> $effectiveWgNoize\")\n            }\n\n            val command = buildCoreCommand(\n""",
        "WireGuard stable-pass selection",
    )

# Pass the resolved settings into CLI argument construction.
call_marker = """                wgNoize = wgNoize,\n            )\n"""
call_marker_transport = """                wgNoize = wgNoize,\n                useMasqueHttp2 = useMasqueHttp2,\n            )\n"""
resolved_call = """                wgNoize = effectiveWgNoize,\n                useMasqueHttp2 = useMasqueHttp2,\n            )\n"""
if resolved_call not in service:
    if call_marker_transport in service:
        service = service.replace(call_marker_transport, resolved_call, 1)
    elif call_marker in service:
        service = service.replace(call_marker, resolved_call, 1)
    else:
        raise SystemExit("resolved transport command arguments were not found")

signature_marker = """        wgNoize: String,\n    ): List<String> {\n"""
if "useMasqueHttp2: Boolean" not in service:
    service = replace_required(
        service,
        signature_marker,
        """        wgNoize: String,\n        useMasqueHttp2: Boolean,\n    ): List<String> {\n""",
        "buildCoreCommand transport parameter",
    )

old_env = """            val processBuilder = ProcessBuilder(command).redirectErrorStream(true)\n            processBuilder.environment().apply {\n                put(\"AETHER_CONFIG\", File(filesDir, \"aether.toml\").absolutePath)\n                put(\"AETHER_MASQUE_HTTP2\", if (masqueHttp2) \"1\" else \"0\")\n                put(\"AETHER_LOG_LEVEL\", \"info\")\n                put(\"RUST_BACKTRACE\", \"1\")\n            }\n"""
new_env = """            val processBuilder = ProcessBuilder(command).redirectErrorStream(true)\n            processBuilder.environment().apply {\n                put(\"AETHER_CONFIG\", File(filesDir, \"aether.toml\").absolutePath)\n                remove(\"AETHER_MASQUE_HTTP2\")\n                if (AndroidTransportPolicy.isMasque(protocol) && useMasqueHttp2) {\n                    put(\"AETHER_MASQUE_HTTP2\", \"1\")\n                }\n                put(\"AETHER_LOG_LEVEL\", \"info\")\n                put(\"RUST_BACKTRACE\", \"1\")\n            }\n"""
if old_env in service:
    service = service.replace(old_env, new_env, 1)
elif 'remove("AETHER_MASQUE_HTTP2")' not in service:
    raise SystemExit("MASQUE environment wiring: neither old nor new block was found")

fixed_timeout = """            if (!waitForSocks(token, bindAddress, process, CORE_START_TIMEOUT_MS)) {\n"""
old_policy_timeout = """            val startupTimeoutMs = AndroidWireGuardPolicy.startupTimeoutMs(protocol, scanMode)\n            log(\"Waiting up to ${startupTimeoutMs / 1000}s for $protocol SOCKS readiness\")\n            if (!waitForSocks(token, bindAddress, process, startupTimeoutMs)) {\n"""
new_timeout = """            val startupTimeoutMs = AndroidTransportPolicy.startupTimeoutMs(protocol, scanMode)\n            log(\"Waiting up to ${startupTimeoutMs / 1000}s for $protocol SOCKS readiness\")\n            if (!waitForSocks(token, bindAddress, process, startupTimeoutMs)) {\n"""
if fixed_timeout in service:
    service = service.replace(fixed_timeout, new_timeout, 1)
elif old_policy_timeout in service:
    service = service.replace(old_policy_timeout, new_timeout, 1)
elif new_timeout not in service:
    raise SystemExit("transport startup timeout wiring was not found")

# A listening local port is not a connected VPN. Verify remote DNS + TCP + HTTP
# through the exact SOCKS endpoint before creating TUN or publishing Connected.
verification_marker = """            ensureActive(token)\n            val connectedAt = System.currentTimeMillis()\n"""
verification_block = """            ensureActive(token)\n            updateSnapshotIfActive(\n                token,\n                FinalServiceSnapshot(\n                    state = \"Verifying\",\n                    socksAddr = bindAddress,\n                )\n            )\n            updateNotification(\"Verifying tunnel egress…\")\n            val initialProbe = AndroidEgressProbe.probe(bindAddress)\n            ensureActive(token)\n            AndroidVpnRuntime.publishProbe(\n                initialProbe.publicIp,\n                initialProbe.countryCode,\n                initialProbe.latencyMs,\n            )\n            log(\n                \"SOCKS egress verified via ${initialProbe.provider}: ${initialProbe.publicIp}\" +\n                    (initialProbe.countryCode?.let { \" · $it\" } ?: \"\") +\n                    \" · ${initialProbe.latencyMs} ms\"\n            )\n            val connectedAt = System.currentTimeMillis()\n"""
if "SOCKS egress verified via ${initialProbe.provider}" not in service:
    service = replace_required(
        service,
        verification_marker,
        verification_block,
        "pre-TUN SOCKS egress verification",
    )

plain_return = """        command += listOf(\n            \"--noize\",\n            if (protocol == \"wireguard\" || protocol == \"gool\") wgNoize else masqueNoize,\n            \"--bind\",\n            bindAddress,\n            \"--log-level\",\n            \"info\",\n        )\n        return command\n"""
old_policy_return = """        command += listOf(\n            \"--noize\",\n            if (protocol == \"wireguard\" || protocol == \"gool\") wgNoize else masqueNoize,\n            \"--bind\",\n            bindAddress,\n            \"--log-level\",\n            \"info\",\n        )\n        AndroidWireGuardPolicy.appendCoreArgs(command, protocol)\n        return command\n"""
new_policy_return = """        command += listOf(\n            \"--noize\",\n            if (protocol == \"wireguard\" || protocol == \"gool\") wgNoize else masqueNoize,\n            \"--bind\",\n            bindAddress,\n            \"--log-level\",\n            \"info\",\n        )\n        AndroidTransportPolicy.appendCoreArgs(command, protocol, useMasqueHttp2)\n        return command\n"""
if plain_return in service:
    service = service.replace(plain_return, new_policy_return, 1)
elif old_policy_return in service:
    service = service.replace(old_policy_return, new_policy_return, 1)
elif new_policy_return not in service:
    raise SystemExit("transport runtime argument wiring was not found")

service = replace_if_present(
    service,
    """        private const val CORE_START_TIMEOUT_MS = 50_000L\n        private const val TUN_MTU = 8500\n""",
    """        private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU\n""",
)
service = replace_if_present(
    service,
    """        private const val TUN_MTU = AndroidWireGuardPolicy.TUN_MTU\n""",
    """        private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU\n""",
)
if "private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU" not in service:
    raise SystemExit("Android transport MTU alignment was not applied")
if "CORE_START_TIMEOUT_MS" in service:
    raise SystemExit("fixed Android core startup timeout still exists")

SERVICE.write_text(service, encoding="utf-8")
print("Android transport policy, stable WG pass, and egress gate applied successfully")
