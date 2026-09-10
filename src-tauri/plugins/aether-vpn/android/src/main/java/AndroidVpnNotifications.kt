package com.cluvexstudio.aethergui.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Owns the Android notification surface for the VPN foreground service.
 *
 * Keep notification policy out of the transport/service lifecycle so status
 * wording, actions, channel behavior and Android-version handling can evolve
 * without touching tunnel teardown or routing code.
 */
internal class AndroidVpnNotifications(
    private val service: FinalAetherVpnService,
) {
    private val manager: NotificationManager =
        service.getSystemService(NotificationManager::class.java)

    fun createChannels() {
        val statusChannel = NotificationChannel(
            STATUS_CHANNEL_ID,
            service.getString(R.string.aether_notification_status_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = service.getString(R.string.aether_notification_status_channel_description)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        val alertChannel = NotificationChannel(
            ALERT_CHANNEL_ID,
            service.getString(R.string.aether_notification_alert_channel),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = service.getString(R.string.aether_notification_alert_channel_description)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        manager.createNotificationChannels(listOf(statusChannel, alertChannel))
    }

    fun start(title: String, text: String) {
        cancelFailure()
        val notification = buildStatus(title, text, connectedAtMs = null, actionRequired = false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            service.startForeground(
                STATUS_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            service.startForeground(STATUS_NOTIFICATION_ID, notification)
        }
    }

    fun update(
        title: String,
        text: String,
        connectedAtMs: Long? = null,
        actionRequired: Boolean = false,
    ) {
        manager.notify(
            STATUS_NOTIFICATION_ID,
            buildStatus(title, text, connectedAtMs, actionRequired),
        )
    }

    fun showFailure() {
        manager.notify(
            FAILURE_NOTIFICATION_ID,
            NotificationCompat.Builder(service, ALERT_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_aether_shield)
                .setContentTitle(service.getString(R.string.aether_notification_failed_title))
                .setContentText(service.getString(R.string.aether_notification_failed_text))
                .setStyle(
                    NotificationCompat.BigTextStyle()
                        .bigText(service.getString(R.string.aether_notification_failed_text)),
                )
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(openAppIntent())
                .build(),
        )
    }

    fun cancelFailure() {
        manager.cancel(FAILURE_NOTIFICATION_ID)
    }

    private fun buildStatus(
        title: String,
        text: String,
        connectedAtMs: Long?,
        actionRequired: Boolean,
    ): Notification {
        val builder = NotificationCompat.Builder(service, STATUS_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_aether_shield)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openAppIntent())
            .addAction(
                R.drawable.ic_stat_aether_stop,
                service.getString(R.string.aether_notification_disconnect),
                disconnectIntent(),
            )

        if (connectedAtMs != null) {
            builder
                .setWhen(connectedAtMs)
                .setUsesChronometer(true)
                .setShowWhen(true)
        } else {
            builder.setShowWhen(false)
        }

        if (actionRequired) {
            builder.addAction(
                R.drawable.ic_stat_aether_shield,
                service.getString(R.string.aether_notification_open),
                openAppIntent(),
            )
        }

        return builder.build()
    }

    private fun openAppIntent(): PendingIntent? {
        val launchIntent = service.packageManager
            .getLaunchIntentForPackage(service.packageName)
            ?.apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            ?: return null
        return PendingIntent.getActivity(
            service,
            OPEN_APP_REQUEST_CODE,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun disconnectIntent(): PendingIntent {
        val intent = Intent(service, FinalAetherVpnService::class.java).apply {
            action = FinalAetherVpnService.ACTION_STOP
        }
        return PendingIntent.getService(
            service,
            DISCONNECT_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val STATUS_NOTIFICATION_ID = 1819
        private const val FAILURE_NOTIFICATION_ID = 1820
        private const val STATUS_CHANNEL_ID = "aether_connection"
        private const val ALERT_CHANNEL_ID = "aether_connection_alerts"
        private const val OPEN_APP_REQUEST_CODE = 18191
        private const val DISCONNECT_REQUEST_CODE = 18192
    }
}
