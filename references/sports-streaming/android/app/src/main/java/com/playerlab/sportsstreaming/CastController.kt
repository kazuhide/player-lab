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
import com.playerlab.sportsstreaming.core.CastConnection

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
    val sessionId get() = boundId
    private val callback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() = observe()
        override fun onMetadataUpdated() = observe()
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
    fun refresh() = observe()
    private fun observe() {
        val session = boundSession ?: return
        if (!session.isConnected) return
        val media = client?.mediaStatus ?: return
        val id = boundId ?: return
        val contentId = media.mediaInfo?.contentId ?: return
        val playing = media.playerState == MediaStatus.PLAYER_STATE_PLAYING
        val paused = media.playerState == MediaStatus.PLAYER_STATE_PAUSED
        onMedia(ReceiverObservation(id, contentId,
            media.streamPosition.takeIf { (playing || paused) && it >= 0 }, playing, paused,
            media.playerState, media.idleReason,
            media.mediaInfo?.streamType == MediaInfo.STREAM_TYPE_LIVE))
    }
    private fun detachClient() { client?.unregisterCallback(callback); client = null }
    override fun close() { detachClient(); manager?.removeSessionManagerListener(listener, CastSession::class.java) }
}

data class ReceiverObservation(
    val sessionId: String, val contentId: String, val positionMs: Long?, val playing: Boolean, val paused: Boolean,
    val playerState: Int, val idleReason: Int, val live: Boolean,
)
