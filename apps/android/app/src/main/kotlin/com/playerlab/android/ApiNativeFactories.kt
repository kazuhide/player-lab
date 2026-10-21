package com.playerlab.android

import android.content.Context
import android.widget.FrameLayout
import androidx.compose.runtime.*
import com.google.android.gms.net.CronetProviderInstaller
import com.bitmovin.media3.database.StandaloneDatabaseProvider
import com.bitmovin.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import com.bitmovin.media3.datasource.cache.SimpleCache
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.advertising.CompanionAdContainer
import com.bitmovin.player.api.source.NetworkEngine
import com.bitmovin.player.api.source.SourceConfig
import org.chromium.net.CronetEngine
import java.io.File

/** Process-owned resource instances. A recreated player must not close a resource still held by a retiring SDK source. */
internal object ApiNativeFactories {
    private const val SDK = "android:com.bitmovin.player.api."
    private const val CACHE = SDK + "TweaksConfig.exoPlayerCache"
    private const val ENGINE = SDK + "source.SourceNetworkConfig.engine"
    private const val CRONET = SDK + "source.NetworkEngine.Cronet.cronetEngine"
    private const val COMPANIONS = SDK + "advertising.AdvertisingConfig.companionAdContainers"
    private val caches = linkedMapOf<Long, SimpleCache>()
    private data class CronetOptions(val http2: Boolean, val quic: Boolean, val brotli: Boolean, val userAgent: String)
    private val engines = linkedMapOf<CronetOptions, CronetEngine>()
    var providerStatus by mutableStateOf("Cronet provider has not been prepared.")
        private set
    private var preparingProvider = false
    fun requiresCronet(values: Map<String, String>) = values[ENGINE] == "Cronet" || CRONET in values
    fun cronetReady() = CronetProviderInstaller.isInstalled()
    fun prepareCronet(context: Context) {
        if (preparingProvider) return
        preparingProvider = true
        providerStatus = "Preparing the Google Play services Cronet provider."
        CronetProviderInstaller.installProvider(context.applicationContext).addOnCompleteListener { task ->
            preparingProvider = false
            providerStatus = if (task.isSuccessful && cronetReady()) "Cronet provider is ready." else "Cronet provider is unavailable. Check Google Play services and network access."
        }
    }
    data class Host(val name: String, val width: Int, val height: Int, val view: FrameLayout)
    data class PreparedPlayer(val config: PlayerConfig, val hosts: List<Host>)
    private val cacheSchema = ApiRecordSchema("cache factory", listOf(ApiRecordField("maxBytes", ApiValueKind.LongInteger, "67108864", minimum = 1.0)), minimumItems = 1, maximumItems = 1)
    private val cronetSchema = ApiRecordSchema("Cronet factory", listOf(
        ApiRecordField("enableHttp2", ApiValueKind.Boolean, "true", choices = listOf("true", "false")),
        ApiRecordField("enableQuic", ApiValueKind.Boolean, "true", choices = listOf("true", "false")),
        ApiRecordField("enableBrotli", ApiValueKind.Boolean, "true", choices = listOf("true", "false")),
        ApiRecordField("userAgent", example = "PlayerLab/Android")), minimumItems = 1, maximumItems = 1)
    private val companionSchema = ApiRecordSchema("companion container", listOf(ApiRecordField("container", example = "banner"),
        ApiRecordField("width", ApiValueKind.Integer, "300", minimum = -1.0), ApiRecordField("height", ApiValueKind.Integer, "250", minimum = -1.0)))
    private fun cacheBytes(value: String): Long? = if (value == "null") null else ApiRecordValues.decode(cacheSchema.normalize(value)).single().getValue("maxBytes").toLong().also {
        require(it in 1..1_073_741_824L) { "The sample cache limit must be between 1 byte and 1 GiB." }
    }
    private fun cronetOptions(value: String): CronetOptions = ApiRecordValues.decode(cronetSchema.normalize(value)).single().let {
        require(it.getValue("userAgent").length <= 512)
        CronetOptions(it.getValue("enableHttp2").toBooleanStrict(), it.getValue("enableQuic").toBooleanStrict(), it.getValue("enableBrotli").toBooleanStrict(), it.getValue("userAgent"))
    }
    fun validate(values: Map<String, String>) {
        values[CACHE]?.let(::cacheBytes)
        values[CRONET]?.let(::cronetOptions)
        val hosts = values[COMPANIONS]?.takeUnless { it == "null" }?.let { ApiRecordValues.decode(companionSchema.normalize(it)) }.orEmpty()
        require(hosts.size <= 4 && hosts.map { it.getValue("container") }.distinct().size == hosts.size) { "Use at most four distinct companion container names." }
        hosts.forEach {
            require(it.getValue("container").matches(Regex("[A-Za-z0-9_-]{1,40}")))
            val width = it.getValue("width").toInt(); val height = it.getValue("height").toInt()
            require(width in 1..4096 && height in 1..4096 || width == -1 && height == -1) { "Use positive dimensions up to 4096, or -1 for both fluid dimensions." }
        }
        require(values[ENGINE] != "HttpURLConnection" || CRONET !in values) { "Remove the Cronet factory override when selecting HttpURLConnection." }
        require(values[ENGINE] != "Cronet" && CRONET !in values || values.keys.none { it.endsWith("NetworkEngine.HttpURLConnection.allowCrossProtocolRedirects") }) { "Remove the HttpURLConnection redirect override before selecting Cronet." }
    }
    @Synchronized private fun cache(context: Context, size: Long): SimpleCache = caches[size] ?: run {
        require(caches.size < 4) { "Four cache configurations are retained by the process. Reuse one or restart the app." }
        SimpleCache(File(context.cacheDir, "sdk-media-cache-$size"), LeastRecentlyUsedCacheEvictor(size), StandaloneDatabaseProvider(context.applicationContext)).also { caches[size] = it }
    }
    @Synchronized private fun cronet(context: Context, options: CronetOptions): CronetEngine = engines[options] ?: run {
        require(engines.size < 4) { "Four Cronet configurations are retained by the process. Reuse one or restart the app." }
        check(cronetReady()) { "Prepare the Google Play services Cronet provider first." }
        CronetEngine.Builder(context.applicationContext).enableHttp2(options.http2).enableQuic(options.quic).enableBrotli(options.brotli)
            .setUserAgent(options.userAgent).build().also { engines[options] = it }
    }
    fun player(context: Context, config: PlayerConfig, values: Map<String, String>): PreparedPlayer {
        val cacheOverride = values[CACHE]?.let(::cacheBytes)?.let { cache(context, it) }
        val hosts = values[COMPANIONS]?.takeUnless { it == "null" }?.let { ApiRecordValues.decode(companionSchema.normalize(it)) }.orEmpty().map {
            Host(it.getValue("container"), it.getValue("width").toInt(), it.getValue("height").toInt(), FrameLayout(context).apply { contentDescription = it.getValue("container") })
        }
        val next = config.copy(
            advertisingConfig = if (COMPANIONS in values) config.advertisingConfig.copy(companionAdContainers = if (values[COMPANIONS] == "null") null else hosts.map { CompanionAdContainer(it.view, it.width, it.height) }) else config.advertisingConfig,
            tweaksConfig = if (CACHE in values) config.tweaksConfig.copy().apply { exoPlayerCache = cacheOverride } else config.tweaksConfig)
        return PreparedPlayer(next, hosts)
    }
    fun source(context: Context, config: SourceConfig, values: Map<String, String>): SourceConfig = config.also {
        when {
            values[ENGINE] == "Cronet" || CRONET in values -> {
                val options = values[CRONET]?.let(::cronetOptions) ?: CronetOptions(true, true, true, "PlayerLab/Android")
                it.networkConfig = it.networkConfig.copy(engine = NetworkEngine.Cronet(cronet(context, options)))
            }
            values[ENGINE] == "HttpURLConnection" -> it.networkConfig = it.networkConfig.copy(engine = NetworkEngine.HttpURLConnection())
        }
    }
    @Synchronized fun snapshot(): Map<String, Any?> = mapOf("cacheInstances" to caches.size, "cacheSpaceBytes" to caches.map { (limit, cache) -> mapOf("limit" to limit, "used" to cache.cacheSpace) }, "cronetInstances" to engines.size, "cronetVersions" to engines.values.map { it.versionString })
    val fields = listOf(
        ApiSetting(CACHE, "TweaksConfig", ApiValueKind.Records, "Creates a real Media3 SimpleCache with least-recently-used eviction. The SDK uses this tweak in read-only mode: ordinary playback does not populate the cache. Assets must be populated separately to test cache hits. This cache is ignored for OfflineSourceConfig. Null disables it for the next player. Each size has a separate app cache directory. Instances are shared and retained for this process; at most four sizes may be used before restarting.", nullable = true, records = cacheSchema,
            code = { value -> if (value == "null") "playerConfig.tweaksConfig.exoPlayerCache = null" else "playerConfig.tweaksConfig.exoPlayerCache = SimpleCache(File(context.cacheDir, \"sdk-media-cache\"), LeastRecentlyUsedCacheEvictor(${cacheBytes(value)}L), StandaloneDatabaseProvider(context.applicationContext)) // Keep one instance for all users of this directory." }),
        ApiSetting(ENGINE, "SourceNetworkConfig", ApiValueKind.Choice, "Select HttpURLConnection or a real Google Play services Cronet engine. The Cronet factory entry edits its constructor options. Prepare the provider with the button above before applying Cronet. Engines are shared within this process. Network protocol negotiation still depends on the server.", choices = listOf("HttpURLConnection", "Cronet"),
            code = { v -> if (v == "Cronet") "val sharedCronetEngine = CronetEngine.Builder(context.applicationContext).enableHttp2(true).enableQuic(true).enableBrotli(true).setUserAgent(\"PlayerLab/Android\").build()\nsourceConfig.networkConfig = sourceConfig.networkConfig.copy(engine = NetworkEngine.Cronet(sharedCronetEngine))" else "sourceConfig.networkConfig = sourceConfig.networkConfig.copy(engine = NetworkEngine.HttpURLConnection())" }),
        ApiSetting(CRONET, "NetworkEngine.Cronet", ApiValueKind.Records, "Creates the actual Google Play services native Cronet engine with these options. This enables the Cronet source engine. Instances are shared by their option values; at most four configurations may be used before restarting the process.", records = cronetSchema,
            code = { value -> val o = cronetOptions(value); "val sharedCronetEngine = CronetEngine.Builder(context.applicationContext).enableHttp2(${o.http2}).enableQuic(${o.quic}).enableBrotli(${o.brotli}).setUserAgent(${kotlinString(o.userAgent)}).build()\nsourceConfig.networkConfig = sourceConfig.networkConfig.copy(engine = NetworkEngine.Cronet(sharedCronetEngine))" }),
        ApiSetting(COMPANIONS, "AdvertisingConfig", ApiValueKind.Records, "Creates actual Android FrameLayout containers below the video. Positive sizes use density-independent pixels for the host layout and are passed unchanged as the requested ad dimensions. Use -1 for both dimensions to request a fluid companion. The SDK receives their native ViewGroup references and requested ad dimensions. Valid companion ads and the advertising integration are needed to fill them. Null unsets the list; an empty list supplies no containers.", nullable = true, records = companionSchema,
            code = { value -> if (value == "null") "playerConfig = playerConfig.copy(advertisingConfig = playerConfig.advertisingConfig.copy(companionAdContainers = null))" else "val companionContainers = listOf(\n" + ApiRecordValues.decode(value).joinToString(",\n") { "    CompanionAdContainer(FrameLayout(context), ${it.getValue("width")}, ${it.getValue("height")}) // Attach this container to the host layout." } + "\n)\nplayerConfig = playerConfig.copy(advertisingConfig = playerConfig.advertisingConfig.copy(companionAdContainers = companionContainers))" }),
    )
}
