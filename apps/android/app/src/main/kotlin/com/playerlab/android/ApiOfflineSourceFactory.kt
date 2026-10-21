package com.playerlab.android

import android.content.Context
import com.bitmovin.player.api.offline.OfflineSourceConfig
import com.bitmovin.player.api.source.SourceConfig
import java.io.File

/** Explicit public OfflineSourceConfig constructor; paths remain inside this app's storage. */
internal data class ApiOfflineSourceDraft(
    val drmIdHex: String = "null",
    val restrictToOffline: Boolean = false,
    val cacheFolder: String = "manual-cache",
    val trackStateFile: String = "manual-track-state",
) {
    private fun safeName(value: String): String = value.also { require(it.matches(Regex("[A-Za-z0-9_-]{1,64}"))) { "Use a single storage name of letters, numbers, hyphens or underscores." } }
    fun drmId(): ByteArray? = if (drmIdHex == "null") null else {
        require(drmIdHex.length in 2..131072 && drmIdHex.length % 2 == 0 && drmIdHex.all { it.digitToIntOrNull(16) != null }) { "Enter an even-length hexadecimal DRM ID, or null." }
        drmIdHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }
    fun validate() { safeName(cacheFolder); safeName(trackStateFile); drmId() }
    fun build(context: Context, base: SourceConfig): OfflineSourceConfig {
        validate()
        val root = File(context.filesDir, "api-offline-source").apply { check(isDirectory || mkdirs()) }
        val cache = File(root, safeName(cacheFolder)).apply { check(isDirectory || mkdirs()) }
        return OfflineSourceConfig(base.url, base.type, drmId(), cache, File(root, safeName(trackStateFile)), restrictToOffline, null).apply {
            title = base.title; description = base.description; posterSource = base.posterSource; options = base.options
        }
    }
    fun code() = "val offlineRoot = File(context.filesDir, \"api-offline-source\")\n" +
        "val offlineSourceConfig = OfflineSourceConfig(sourceConfig.url, sourceConfig.type, " +
        (if (drmIdHex == "null") "null" else "privateDrmIdBytes") + ", File(offlineRoot, ${kotlinString(safeName(cacheFolder))}), File(offlineRoot, ${kotlinString(safeName(trackStateFile))}), $restrictToOffline, null)\nplayer.load(Source(offlineSourceConfig))"
}
