package com.playerlab.android

import android.app.Application
import android.content.Context
import com.bitmovin.player.api.DebugConfig

/** Startup-only SDK options must be set before Player/Source/View construction. */
class PlayerLabApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        DebugConfig.isLoggingEnabled = ApiStartupSettings.read(this)
    }
}

internal object ApiStartupSettings {
    private const val STORE = "sdk-startup"
    private const val LOGGING = "debug-logging"
    fun read(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean(LOGGING, false)
    fun save(context: Context, enabled: Boolean): Boolean = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean(LOGGING, enabled).commit()
}
