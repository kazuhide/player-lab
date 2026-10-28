package com.playerlab.sportsstreaming

import android.content.Context
import com.playerlab.sportsstreaming.core.CatalogParser
import com.playerlab.sportsstreaming.core.SportsCatalog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI

class CatalogRepository(private val context: Context) {
    private var debugMediaBase: String? = null
    fun overrideMediaBaseForDebug(url: String) {
        check(BuildConfig.DEBUG)
        debugMediaBase = CatalogParser.httpUri(url.trimEnd('/') + "/").toASCIIString()
    }
    data class CatalogResult(val catalog: SportsCatalog, val offline: Boolean)
    suspend fun catalog(): CatalogResult = withContext(Dispatchers.IO) {
        val base = debugMediaBase ?: BuildConfig.MEDIA_BASE_URL
        val url = if (debugMediaBase != null) URI(base).resolve("catalog.json").toString()
            else BuildConfig.CATALOG_URL.ifBlank { URI(base).resolve("catalog.json").toString() }
        runCatching { CatalogResult(CatalogParser.parse(fetch(url), base), false) }
            .getOrElse { error ->
                if (error is CancellationException) throw error
                val bundled = context.assets.open("catalog.json").bufferedReader().use { it.readText() }
                CatalogResult(CatalogParser.parse(bundled, base), true)
            }
    }
    suspend fun status(url: String): String = withContext(Dispatchers.IO) { fetch(url, 16 * 1024) }

    private fun fetch(url: String, limit: Int = 512 * 1024): String {
        val connection = (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
        }
        return try {
            check(connection.responseCode in 200..299) { "Catalog HTTP failure" }
            connection.inputStream.use { input ->
                val bytes = ByteArrayOutputStream()
                val buffer = ByteArray(8_192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    check(bytes.size() + count <= limit) { "Catalog response exceeds size limit" }
                    bytes.write(buffer, 0, count)
                }
                bytes.toString(Charsets.UTF_8.name())
            }
        } finally { connection.disconnect() }
    }
}
