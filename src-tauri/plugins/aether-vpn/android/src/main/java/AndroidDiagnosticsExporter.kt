package com.cluvexstudio.aethergui.vpn

import android.app.Activity
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.ContentValues
import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

data class FinalDiagnosticsExport(
    val fileName: String,
    val uri: String,
)

/**
 * Builds a bounded, user-triggered troubleshooting bundle without adb.
 *
 * The exporter deliberately reads only process-local diagnostic state and
 * coarse Android network metadata. Connection profile credentials, Zero Trust
 * secrets and upstream proxy credentials are never collected here.
 */
internal object AndroidDiagnosticsExporter {
    fun export(activity: Activity): FinalDiagnosticsExport {
        AndroidVpnRuntime.initialize(activity)
        val generatedAtMs = System.currentTimeMillis()
        val fileName = "Aether-diagnostics-$generatedAtMs.zip"
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/zip")
            put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                "${Environment.DIRECTORY_DOWNLOADS}/Aether",
            )
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: error("Android could not create the diagnostics file in Downloads")

        try {
            val output = resolver.openOutputStream(uri, "w")
                ?: error("Android could not open the diagnostics file for writing")
            output.use { stream ->
                ZipOutputStream(stream.buffered()).use { zip ->
                    writeEntry(zip, "README.txt", readme())
                    writeEntry(zip, "runtime.json", runtimeJson(activity, generatedAtMs).toString(2))
                    writeEntry(zip, "network-capabilities.json", networkJson(activity).toString(2))
                    writeEntry(
                        zip,
                        "runtime.log",
                        AndroidVpnRuntime.diagnosticLogLines().joinToString("\n", postfix = "\n"),
                    )
                }
            }

            resolver.update(
                uri,
                ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
                null,
                null,
            )
            return FinalDiagnosticsExport(fileName = fileName, uri = uri.toString())
        } catch (error: Throwable) {
            runCatching { resolver.delete(uri, null, null) }
            throw error
        }
    }

    private fun runtimeJson(activity: Activity, generatedAtMs: Long): JSONObject {
        val status = AndroidVpnRuntime.snapshot()
        val telemetry = AndroidVpnRuntime.telemetrySnapshot()
        val failure = AndroidVpnRuntime.lastFailureSnapshot()
        val packageInfo = runCatching {
            activity.packageManager.getPackageInfo(activity.packageName, 0)
        }.getOrNull()

        return JSONObject().apply {
            put("generated_at_ms", generatedAtMs)
            put("app_version", packageInfo?.versionName ?: JSONObject.NULL)
            put("android_sdk", Build.VERSION.SDK_INT)
            put("manufacturer", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("supported_abis", JSONArray(Build.SUPPORTED_ABIS.toList()))
            put(
                "status",
                JSONObject().apply {
                    put("state", status.state)
                    put("message", status.message ?: JSONObject.NULL)
                    put("socks_addr", status.socksAddr ?: JSONObject.NULL)
                    put("tun_addr", status.tunAddr ?: JSONObject.NULL)
                    put("connected_at_ms", status.connectedAtMs ?: JSONObject.NULL)
                },
            )
            put(
                "telemetry",
                JSONObject().apply {
                    put("received_bytes", telemetry.receivedBytes)
                    put("sent_bytes", telemetry.sentBytes)
                    put("public_ip", telemetry.publicIp ?: JSONObject.NULL)
                    put("country_code", telemetry.countryCode ?: JSONObject.NULL)
                    put("latency_ms", telemetry.latencyMs ?: JSONObject.NULL)
                    put("sampled_at_ms", telemetry.sampledAtMs)
                    put("egress_probe_complete", telemetry.egressProbeComplete)
                    put("capacity_probe_complete", telemetry.capacityProbeComplete)
                    put("download_kbps", telemetry.downloadKbps ?: JSONObject.NULL)
                    put("upload_kbps", telemetry.uploadKbps ?: JSONObject.NULL)
                    put("upload_limited", telemetry.uploadLimited)
                },
            )
            put(
                "last_failure",
                failure?.let {
                    JSONObject().apply {
                        put("timestamp", it.timestamp)
                        put("source", it.source)
                        put("message", it.message)
                    }
                } ?: JSONObject.NULL,
            )
            put("historical_process_exits", historicalProcessExits(activity))
        }
    }

    private fun historicalProcessExits(activity: Activity): JSONArray {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return JSONArray()
        val activityManager =
            activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val exits = runCatching {
            activityManager.getHistoricalProcessExitReasons(activity.packageName, 0, 5)
        }.getOrDefault(emptyList())

        return JSONArray().apply {
            exits.take(5).forEach { exit ->
                put(JSONObject().apply {
                    put("timestamp", exit.timestamp)
                    put("reason", exit.reason)
                    put("reason_label", exitReasonLabel(exit.reason))
                    put("status", exit.status)
                    put("importance", exit.importance)
                    put("pss_kb", exit.pss)
                    put("rss_kb", exit.rss)
                    put("description", exit.description ?: JSONObject.NULL)
                    put("process_name", exit.processName ?: JSONObject.NULL)
                })
            }
        }
    }

    private fun exitReasonLabel(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_UNKNOWN -> "unknown"
        ApplicationExitInfo.REASON_EXIT_SELF -> "exit-self"
        ApplicationExitInfo.REASON_SIGNALED -> "signaled"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "low-memory"
        ApplicationExitInfo.REASON_CRASH -> "java-crash"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "native-crash"
        ApplicationExitInfo.REASON_ANR -> "anr"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization-failure"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission-change"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive-resource-usage"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "user-requested"
        ApplicationExitInfo.REASON_USER_STOPPED -> "user-stopped"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency-died"
        ApplicationExitInfo.REASON_OTHER -> "other"
        else -> "reason-$reason"
    }

    private fun networkJson(activity: Activity): JSONObject {
        val connectivity =
            activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val active = connectivity.activeNetwork
        val networks = JSONArray()
        connectivity.allNetworks.forEach { network ->
            networks.put(
                networkSnapshot(
                    network = network,
                    capabilities = connectivity.getNetworkCapabilities(network),
                    link = connectivity.getLinkProperties(network),
                    active = network == active,
                ),
            )
        }

        return JSONObject().apply {
            put("active_network", active != null)
            put("network_count", networks.length())
            put("networks", networks)
        }
    }

    private fun networkSnapshot(
        network: Network,
        capabilities: NetworkCapabilities?,
        link: LinkProperties?,
        active: Boolean,
    ): JSONObject {
        val transports = JSONArray().apply {
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) put("wifi")
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true) put("cellular")
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true) put("ethernet")
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true) put("vpn")
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) == true) put("bluetooth")
        }

        return JSONObject().apply {
            put("network_id", network.toString())
            put("active", active)
            put("transports", transports)
            put(
                "internet_capability",
                capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true,
            )
            put(
                "validated",
                capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true,
            )
            put(
                "metered",
                capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) != true,
            )
            put(
                "roaming",
                capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING) != true,
            )
            put("interface_name", link?.interfaceName ?: JSONObject.NULL)
            put("private_dns_active", link?.isPrivateDnsActive ?: false)
            put("private_dns_server", link?.privateDnsServerName ?: JSONObject.NULL)
            put(
                "dns_servers",
                JSONArray(link?.dnsServers?.map { it.hostAddress ?: it.toString() } ?: emptyList<String>()),
            )
            put(
                "link_addresses",
                JSONArray(link?.linkAddresses?.map { it.toString() } ?: emptyList<String>()),
            )
        }
    }

    private fun readme(): String = """
        Aether Android diagnostics

        This bundle was created locally on the device after an explicit user action.
        It contains a bounded runtime/core/service log tail, current VPN status,
        telemetry, the most recent recorded runtime failure, recent Android process
        exit metadata (including native-crash reason on Android 11+), and network
        capability metadata for the visible VPN and underlay networks.

        Aether does not intentionally include Zero Trust credentials, access codes,
        access tokens, service-token secrets, or upstream proxy credentials.
        The bundle can contain IP addresses, selected endpoints, DNS servers, device
        model information, and other troubleshooting metadata. Review it before
        sharing if that information is sensitive to you.
    """.trimIndent() + "\n"

    private fun writeEntry(zip: ZipOutputStream, name: String, body: String) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(body.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }
}
