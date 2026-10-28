package com.playerlab.sportsstreaming.core

/** Binds receiver observations to one actual Source load, independently of its media URL. */
class ReceiverLoadGuard(val loadToken: String) {
    var mediaSessionId: Long? = null
        private set
    var failed = false
        private set

    fun accepts(current: PlaybackRequest?, expected: PlaybackRequest, connection: String?,
                observedConnection: String, observedMediaSessionId: Long?, observedLoadToken: String?,
                contentMatches: Boolean): Boolean {
        if (failed || !matches(current, expected, connection, observedConnection, observedMediaSessionId, observedLoadToken, contentMatches)) return false
        mediaSessionId = observedMediaSessionId
        return true
    }

    fun fail(current: PlaybackRequest?, expected: PlaybackRequest, connection: String?,
             observedConnection: String, observedMediaSessionId: Long?, observedLoadToken: String?, contentMatches: Boolean): Boolean {
        if (failed || !matches(current, expected, connection, observedConnection, observedMediaSessionId, observedLoadToken, contentMatches)) return false
        mediaSessionId = observedMediaSessionId
        failed = true
        return true
    }

    private fun matches(current: PlaybackRequest?, expected: PlaybackRequest, connection: String?,
                        observedConnection: String, observedMediaSessionId: Long?, observedLoadToken: String?,
                        contentMatches: Boolean): Boolean =
        current == expected && connection != null && connection == observedConnection && contentMatches &&
            observedLoadToken == loadToken && observedMediaSessionId != null && observedMediaSessionId > 0 &&
            (mediaSessionId == null || mediaSessionId == observedMediaSessionId)
}
