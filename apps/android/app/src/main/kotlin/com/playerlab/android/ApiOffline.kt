package com.playerlab.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.bitmovin.player.api.deficiency.ErrorEvent
import com.bitmovin.player.api.event.OfflineEvent
import com.bitmovin.player.api.offline.*
import com.bitmovin.player.api.offline.options.*
import com.bitmovin.player.api.source.SourceConfig
import java.io.File

/** Owns one SDK download manager. Downloaded files outlive the UI until explicitly deleted. */
internal class ApiOffline(context: Context, private val onEvent: (String, Long) -> Unit) {
    private val context = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var generation = 0L
    private var disposed = false
    private var subscriptions = emptyList<() -> Unit>()
    internal var manager: OfflineContentManager? = null
        private set
    internal var options: OfflineContentOptions? by mutableStateOf(null)
        private set
    internal var revision by mutableStateOf(0)
        private set
    internal var status by mutableStateOf("Create a download manager for the current source.")
        private set
    internal var progress by mutableStateOf(0f)
        private set
    internal var completed by mutableStateOf(false)
        private set
    internal var contentId by mutableStateOf("")
        private set

    internal fun open(source: SourceConfig, id: String) {
        check(!disposed)
        require(id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) { "Use a stable content ID containing letters, digits, underscores or hyphens." }
        releaseManager()
        val epoch = generation
        fun update(action: () -> Unit) {
            val guarded = { if (!disposed && generation == epoch) action() }
            if (Looper.myLooper() == Looper.getMainLooper()) guarded() else main.post { guarded() }
        }
        val listener = object : OfflineContentManagerListener {
            override fun onOptionsAvailable(sourceConfig: SourceConfig, offlineContentOptions: OfflineContentOptions) = update {
                options = offlineContentOptions; revision++; status = "SDK options available. Select actions before processing."
            }
            override fun onProgress(sourceConfig: SourceConfig, progress: Float) = update {
                this@ApiOffline.progress = progress; status = "Processing selected offline actions."
            }
            override fun onCompleted(sourceConfig: SourceConfig, offlineContentOptions: OfflineContentOptions) = update {
                options = offlineContentOptions; revision++; completed = true; progress = 100f; status = "SDK processing completed. Inspect track states before playback."
            }
            override fun onError(sourceConfig: SourceConfig, errorEvent: ErrorEvent) = update {
                status = "Offline SDK error ${errorEvent.code.value}. Inspect source, storage, network and license settings."
            }
            override fun onSuspended(sourceConfig: SourceConfig) = update { status = "Offline actions suspended." }
            override fun onResumed(sourceConfig: SourceConfig) = update { status = "Offline actions resumed." }
            override fun onDrmLicenseUpdated(sourceConfig: SourceConfig) = update { status = "Offline DRM license updated." }
        }
        val candidate = OfflineContentManager.getOfflineContentManager(
            source, File(context.filesDir, "offline").absolutePath, id, listener, context,
        )
        manager = candidate
        contentId = id
        status = "Download manager created. Fetch options to inspect available tracks."
        val error: (OfflineEvent.Error) -> Unit = { event -> update { onEvent("OfflineEvent.Error", event.timestamp) } }
        val info: (OfflineEvent.Info) -> Unit = { event -> update { onEvent("OfflineEvent.Info", event.timestamp) } }
        val warning: (OfflineEvent.Warning) -> Unit = { event -> update { onEvent("OfflineEvent.Warning", event.timestamp) } }
        candidate.on(OfflineEvent.Error::class, error)
        candidate.on(OfflineEvent.Info::class, info)
        candidate.on(OfflineEvent.Warning::class, warning)
        subscriptions = listOf(
            { candidate.off(OfflineEvent.Error::class, error) },
            { candidate.off(OfflineEvent.Info::class, info) },
            { candidate.off(OfflineEvent.Warning::class, warning) },
        )
    }

    internal fun applyConfig(config: OfflineConfig) {
        check(!disposed)
        OfflineContentManager.setOfflineConfig(context, config)
        status = "Offline configuration applied to the SDK download service."
    }

    internal fun entries(): List<Pair<String, OfflineOptionEntry>> = options?.let { value ->
        value.videoOptions.mapIndexed { index, entry -> "video-$index" to entry } +
            value.audioOptions.mapIndexed { index, entry -> "audio-$index" to entry } +
            value.textOptions.mapIndexed { index, entry -> "text-$index" to entry } +
            listOfNotNull(value.thumbnailOption?.let { "thumbnail-0" to it })
    }.orEmpty()

    internal fun setAction(key: String, action: OfflineOptionEntryAction?) {
        entries().first { it.first == key }.second.action = action
        completed = false
        revision++
    }

    internal fun getOptions() = requireManager().getOptions()
    internal fun process() {
        completed = false
        requireManager().process(requireNotNull(options) { "Fetch SDK options first." })
    }
    internal fun requireManager() = requireNotNull(manager) { "Create a download manager first." }
    internal fun releaseManager() {
        generation++
        subscriptions.forEach { it() }
        subscriptions = emptyList()
        manager?.release()
        manager = null
        options = null
        contentId = ""
        progress = 0f
        completed = false
        revision++
        status = "Manager released. Stored files remain until explicitly deleted."
    }
    internal fun dispose() {
        if (disposed) return
        disposed = true
        releaseManager()
        main.removeCallbacksAndMessages(null)
    }
}

internal data class ApiOfflineConfigDraft(
    val downloads: String = "3",
    val segments: String = "3",
    val requirements: Set<DeviceStateRequirement> = setOf(DeviceStateRequirement.Network),
    val automaticDrm: Boolean = true,
) {
    fun build(): OfflineConfig {
        val concurrentDownloads = downloads.toIntOrNull() ?: error("Enter a whole download count.")
        val concurrentSegments = segments.toIntOrNull() ?: error("Enter a whole segment count.")
        require(concurrentDownloads > 0 && concurrentSegments > 0) { "Download counts must be positive." }
        return OfflineConfig(concurrentDownloads, concurrentSegments, requirements.toSet(), OfflineTweaksConfig(automaticDrm))
    }
    fun code(): String {
        val config = build()
        val requirementsCode = requirements.joinToString(", ", "setOf(", ")") { "DeviceStateRequirement.${it.name}" }
        return """
            // Import com.bitmovin.player.api.offline.*.
            OfflineContentManager.setOfflineConfig(context, OfflineConfig(
                maxSimultaneousDownloads = ${config.maxSimultaneousDownloads},
                maxSimultaneousSegmentDownloads = ${config.maxSimultaneousSegmentDownloads},
                deviceStateRequirements = $requirementsCode,
                tweaksConfig = OfflineTweaksConfig(shouldAutomaticallyHandleDrmLicenses = $automaticDrm),
            ))
        """.trimIndent()
    }
}

internal fun offlineEntrySummary(entry: OfflineOptionEntry): Map<String, Any?> = buildMap {
    put("id", entry.id); put("bitrate", entry.bitrate); put("mimeType", entry.mimeType)
    put("codecs", entry.codecs); put("language", entry.language); put("state", entry.state.name); put("action", entry.action?.name)
    if (entry is VideoOfflineOptionEntry) {
        put("width", entry.width); put("height", entry.height); put("frameRate", entry.frameRate)
    }
    if (entry is AudioOfflineOptionEntry) { put("channelCount", entry.channelCount); put("sampleRate", entry.sampleRate) }
}
