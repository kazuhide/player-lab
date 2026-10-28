package com.playerlab.sportsstreaming

import android.content.Context
import androidx.mediarouter.media.MediaRouter
import org.json.JSONObject
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.cast.framework.media.MediaQueue
import java.security.MessageDigest
import com.playerlab.sportsstreaming.core.CastConnection
import com.playerlab.sportsstreaming.core.ReceiverIdentityParser

/** Observes CAF only. Bitmovin Player remains the sole owner of media load and transport commands. */
class CastController(
    context: Context,
    private val onConnection: (CastConnection, String, String?) -> Unit,
    private val onMedia: (ReceiverObservation) -> Unit,
    private val onFailure: () -> Unit,
) : AutoCloseable {
    private var initializationFailure: String? = null
    private val castContext = runCatching { CastContext.getSharedInstance(context) }.getOrElse { error ->
        initializationFailure = error.javaClass.simpleName.take(100)
        null
    }
    private val manager = castContext?.sessionManager
    private val mediaRouter = MediaRouter.getInstance(context)
    private var boundSession: CastSession? = null
    private var client: RemoteMediaClient? = null
    private var boundId: String? = null
    private var generation = 0L
    var statusRevision = 0L
        private set
    val sessionId get() = boundId
    val isConnected get() = boundSession?.isConnected == true
    private val callback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() { statusRevision++; observe() }
        override fun onMetadataUpdated() = observe()
    }
    private val queueCallback = object : MediaQueue.Callback() {
        override fun mediaQueueChanged() = observe()
        override fun itemsReloaded() = observe()
        override fun itemsUpdatedAtIndexes(indexes: IntArray) = observe()
        override fun itemsRemovedAtIndexes(indexes: IntArray) = observe()
    }
    private val listener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) {
            detachClient()
            boundSession = session
            boundId = "connecting:${++generation}"
            notify(CastConnection.CONNECTING)
        }
        override fun onSessionStarted(session: CastSession, sessionId: String) {
            if (session === boundSession || manager?.currentCastSession === session) attach(session, sessionId)
        }
        override fun onSessionStartFailed(session: CastSession, error: Int) {
            if (session !== boundSession) return
            notify(CastConnection.DISCONNECTED); detachClient(); onFailure()
        }
        override fun onSessionEnding(session: CastSession) = Unit
        override fun onSessionEnded(session: CastSession, error: Int) {
            if (session !== boundSession) return
            notify(CastConnection.DISCONNECTED)
            detachClient()
        }
        override fun onSessionResuming(session: CastSession, sessionId: String) {
            if (session !== boundSession && manager?.currentCastSession !== session) return
            if (session !== boundSession) {
                boundSession = session; boundId = sessionId
            }
            notify(CastConnection.RECONNECTING)
        }
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
            if (session !== boundSession) return
            val id = session.sessionId ?: return
            attach(session, id)
        }
        override fun onSessionResumeFailed(session: CastSession, error: Int) {
            if (session !== boundSession) return
            notify(CastConnection.DISCONNECTED); detachClient(); onFailure()
        }
        override fun onSessionSuspended(session: CastSession, reason: Int) {
            if (session === boundSession) notify(CastConnection.RECONNECTING)
        }
    }
    init {
        manager?.addSessionManagerListener(listener, CastSession::class.java)
        manager?.currentCastSession?.takeIf { it.isConnected }?.let { session ->
            session.sessionId?.let { attach(session, it) }
        }
    }
    private fun attach(session: CastSession, id: String) {
        detachClient()
        boundSession = session
        boundId = id
        client = session.remoteMediaClient
        client?.registerCallback(callback)
        client?.mediaQueue?.registerCallback(queueCallback)
        notify(CastConnection.CONNECTED)
        observe()
    }
    private fun notify(connection: CastConnection) {
        val id = boundId ?: return
        onConnection(connection, id, boundSession?.castDevice?.friendlyName)
    }
    fun diagnostics(expectedReceiver: String?): JSONObject {
        val selector = castContext?.mergedSelector
        val routes = selector?.let { selected -> mediaRouter.routes.filter { it.matchesSelector(selected) } }
        return JSONObject().put("contextCreated", castContext != null)
            .put("initializationFailure", initializationFailure ?: JSONObject.NULL)
            .put("castState", castContext?.castState ?: JSONObject.NULL)
            .put("matchingRouteCount", routes?.size ?: JSONObject.NULL)
            .put("authorizedReceiverPresent", expectedReceiver?.let { name -> routes?.any { it.name == name } } ?: JSONObject.NULL)
    }
    fun queueDiagnostics(): JSONObject {
        val snapshot = queueSnapshot() ?: return JSONObject()
        return JSONObject().put("itemCount", snapshot.count).put("headCached", snapshot.headCached)
            .put("headContentSha256", snapshot.headContentId?.let { value ->
                MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
            } ?: JSONObject.NULL)
    }
    fun queueSnapshot(): ReceiverQueueSnapshot? {
        val queue = client?.takeIf { boundSession?.isConnected == true }?.mediaQueue ?: return null
        val count = queue.itemCount
        val head = if (count > 0) queue.getItemAtIndex(0, false) else null
        return ReceiverQueueSnapshot(count, head != null, head?.media?.contentId)
    }
    fun refreshStoppedQueueOnce() {
        val current = client?.takeIf { boundSession?.isConnected == true } ?: return
        val queue = current.mediaQueue
        if (queue.itemCount > 0 && queue.getItemAtIndex(0, false) == null) queue.getItemAtIndex(0)
        current.requestStatus()
    }
    fun refresh() = observe()
    private fun observe() {
        val session = boundSession ?: return
        if (!session.isConnected) return
        val currentClient = client ?: return
        val queue = currentClient.mediaQueue
        val queueCount = queue.itemCount
        // Passive cache inspection must not trigger another item fetch while the SDK owns its load.
        val head = if (queueCount > 0) queue.getItemAtIndex(0, false) else null
        val media = currentClient.mediaStatus
        val id = boundId ?: return
        if (media == null) {
            onMedia(ReceiverObservation(id, "", null, false, false, null, null, false,
                null, null, statusRevision, mediaPresent = false, queueItemCount = queueCount,
                queueHeadCached = head != null, queueHeadContentId = head?.media?.contentId))
            return
        }
        val contentId = media.mediaInfo?.contentId ?: ""
        // toJson is a public CAF API; the protocol carries its receiver-assigned mediaSessionId.
        val identity = ReceiverIdentityParser.parse(media.toJson())
        val playing = media.playerState == MediaStatus.PLAYER_STATE_PLAYING
        val paused = media.playerState == MediaStatus.PLAYER_STATE_PAUSED
        onMedia(ReceiverObservation(id, contentId,
            currentClient.approximateStreamPosition.takeIf { (playing || paused) && it >= 0 }, playing, paused,
            media.playerState, media.idleReason,
            media.mediaInfo?.streamType == MediaInfo.STREAM_TYPE_LIVE,
            identity.mediaSessionId, identity.sourceLoadToken, statusRevision,
            mediaPresent = true, queueItemCount = queueCount, queueHeadCached = head != null,
            queueHeadContentId = head?.media?.contentId,
            seekableStartMs = media.liveSeekableRange?.let { currentClient.approximateLiveSeekableRangeStart },
            seekableEndMs = media.liveSeekableRange?.let { currentClient.approximateLiveSeekableRangeEnd },
            startAbsoluteTimeMs = media.mediaInfo?.startAbsoluteTime?.takeIf { it >= 0 },
            reportedPositionMs = media.streamPosition.takeIf { it >= 0 },
            reportedSeekableStartMs = media.liveSeekableRange?.startTime,
            reportedSeekableEndMs = media.liveSeekableRange?.endTime,
            customStartAbsoluteSeconds = (media.customData?.opt("startAbsoluteTime") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }))
    }
    private fun detachClient() {
        client?.mediaQueue?.unregisterCallback(queueCallback)
        client?.unregisterCallback(callback); client = null
    }
    override fun close() { detachClient(); manager?.removeSessionManagerListener(listener, CastSession::class.java) }
}

data class ReceiverObservation(
    val sessionId: String, val contentId: String, val positionMs: Long?, val playing: Boolean, val paused: Boolean,
    val playerState: Int?, val idleReason: Int?, val live: Boolean,
    val mediaSessionId: Long?, val sourceLoadToken: String?,
    val statusRevision: Long, val mediaPresent: Boolean, val queueItemCount: Int,
    val queueHeadCached: Boolean = false, val queueHeadContentId: String? = null,
    val seekableStartMs: Long? = null, val seekableEndMs: Long? = null,
    val startAbsoluteTimeMs: Long? = null,
    val reportedPositionMs: Long? = null, val reportedSeekableStartMs: Long? = null, val reportedSeekableEndMs: Long? = null,
    val customStartAbsoluteSeconds: Double? = null,
)
data class ReceiverQueueSnapshot(val count: Int, val headCached: Boolean, val headContentId: String?)
