package com.playerlab.sportsstreaming.core

enum class CastConnection { CONNECTING, CONNECTED, RECONNECTING, DISCONNECTED }

/** Receiver position is nullable and is never replaced with the sender's position or zero. */
class CastRecovery {
    var connection = CastConnection.DISCONNECTED
        private set
    private var sessionId: String? = null
    private var hadRemoteOwnership = false
    var lastObservedAssetId: String? = null
        private set
    var lastObservedPositionMs: Long? = null
        private set
    var needsLocalReturnChoice = false
        private set

    fun connecting(id: String) {
        require(id.isNotBlank())
        if (sessionId != id) {
            lastObservedAssetId = null
            lastObservedPositionMs = null
            hadRemoteOwnership = false
        }
        sessionId = id
        needsLocalReturnChoice = false
        connection = CastConnection.CONNECTING
    }
    fun connected(id: String) {
        if (id != sessionId || connection !in setOf(CastConnection.CONNECTING, CastConnection.RECONNECTING)) return
        hadRemoteOwnership = true
        needsLocalReturnChoice = false
        connection = CastConnection.CONNECTED
    }
    fun reconnecting(id: String) {
        if (id == sessionId && hadRemoteOwnership && connection == CastConnection.CONNECTED) connection = CastConnection.RECONNECTING
    }
    fun observe(id: String, assetId: String, positionMs: Long?): Boolean {
        if (id != sessionId || connection !in setOf(CastConnection.CONNECTED, CastConnection.RECONNECTING)) return false
        if (assetId.isBlank() || (positionMs != null && positionMs < 0)) return false
        lastObservedAssetId = assetId
        lastObservedPositionMs = positionMs
        return true
    }
    fun disconnected(id: String) {
        if (id != sessionId) return
        connection = CastConnection.DISCONNECTED
        needsLocalReturnChoice = hadRemoteOwnership
    }
    fun localResumePosition(): Long? = lastObservedPositionMs
    fun acknowledgeLocalChoice() { needsLocalReturnChoice = false }
}
