package com.playerlab.android

import android.content.Context
import com.bitmovin.player.api.deficiency.ErrorEvent
import com.bitmovin.player.api.offline.OfflineContentManager
import com.bitmovin.player.api.offline.OfflineContentManagerListener
import com.bitmovin.player.api.offline.OfflineSourceConfig
import com.bitmovin.player.api.offline.options.OfflineContentOptions
import com.bitmovin.player.api.offline.options.OfflineOptionEntryAction
import com.bitmovin.player.api.source.SourceConfig
import java.io.File

/**
 * Offline download for one source. Wraps `OfflineContentManager`: requests options,
 * marks the smallest video + first audio rendition for download, processes them,
 * and hands back an `OfflineSourceConfig` for offline playback.
 *
 * On-device feature — needs the license keyed to `com.playerlab.android` and the
 * `BitmovinDownloadService` declared in the manifest (see README). The API usage
 * here is compiled in CI (`:app:assembleDebugAndroidTest`/`assembleDebug`).
 */
class OfflineManager(
    context: Context,
    private val source: SourceConfig,
    id: String,
    private val onState: (state: State, progress: Float) -> Unit,
) : OfflineContentManagerListener {

    enum class State { IDLE, DOWNLOADING, COMPLETED, ERROR }

    private val manager: OfflineContentManager =
        OfflineContentManager.getOfflineContentManager(
            source,
            File(context.filesDir, "offline/$id").absolutePath,
            id,
            this,
            context,
        )

    /** Begin a download: triggers `onOptionsAvailable`, which marks tracks + processes. */
    fun startDownload() {
        onState(State.DOWNLOADING, 0f)
        manager.getOptions()
    }

    /** The offline source to load for offline playback, or null if not downloaded. */
    fun offlineSource(): OfflineSourceConfig? = runCatching { manager.offlineSourceConfig }.getOrNull()

    fun delete() = manager.deleteAll()

    fun release() = manager.release()

    override fun onOptionsAvailable(source: SourceConfig, options: OfflineContentOptions) {
        // Smallest video rendition + first audio — enough to demo offline playback.
        options.videoOptions.minByOrNull { it.bitrate }?.action = OfflineOptionEntryAction.Download
        options.audioOptions.firstOrNull()?.action = OfflineOptionEntryAction.Download
        manager.process(options)
    }

    override fun onProgress(source: SourceConfig, progress: Float) = onState(State.DOWNLOADING, progress)

    override fun onCompleted(source: SourceConfig, options: OfflineContentOptions) = onState(State.COMPLETED, 100f)

    override fun onError(source: SourceConfig, event: ErrorEvent) = onState(State.ERROR, 0f)

    override fun onSuspended(source: SourceConfig) {}

    override fun onResumed(source: SourceConfig) {}

    override fun onDrmLicenseUpdated(source: SourceConfig) {}
}
