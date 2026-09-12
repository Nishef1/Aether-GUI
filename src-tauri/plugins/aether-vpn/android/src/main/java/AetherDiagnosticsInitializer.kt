package com.cluvexstudio.aethergui.vpn

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

/**
 * Process initializer for bounded crash diagnostics and VPN background liveness.
 *
 * A private ContentProvider is created by Android before the app UI and VPN
 * service are used, so the uncaught-exception handler can persist one small
 * crash summary even when the process dies before the diagnostics screen opens.
 * It also installs the screen-state listener used to keep an already-active VPN
 * dataplane schedulable while the display is off.
 */
class AetherDiagnosticsInitializer : ContentProvider() {
    override fun onCreate(): Boolean {
        context?.applicationContext?.let { appContext ->
            AndroidVpnRuntime.initialize(appContext)
            AndroidScreenOffKeepAlive.initialize(appContext)
        }
        return true
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0
}
