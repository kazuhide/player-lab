package com.playerlab.android

import android.content.Context

/** Called on the IO dispatcher. This preferences file is excluded from backup and device transfer. */
internal class AndroidConfigurationProfileStorage(context: Context) : ConfigurationProfileStorage {
    companion object { const val STORE = "configuration-profiles"; const val KEY = "profiles" }
    private val application = context.applicationContext
    override fun read() = application.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString(KEY, null)
    override fun write(value: String?): Boolean {
        val preferences = application.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val prior = preferences.getString(KEY, null)
        val saved = preferences.edit().putString(KEY, value).commit()
        // commit can update its in-process map even when durable writing fails.
        if (!saved) preferences.edit().putString(KEY, prior).commit()
        return saved
    }
}
