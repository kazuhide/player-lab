package com.playerlab.sportsstreaming.core

/** Readiness belongs to one Source and its actual local or receiver destination. */
class SourceReadiness(private val loadToken: String, private var request: PlaybackRequest?) {
    private var loaded = false
    private var ready = false
    private var receiverReady = false
    private var failed = false
    val localSdkReady get() = loaded && ready && !failed
    val receiverPlayable get() = receiverReady && !failed
    val isReady get() = !failed && if (request?.destination?.startsWith("cast:") == true) receiverReady else loaded && ready
    fun onLoaded(token: String, current: PlaybackRequest?) {
        if (token == loadToken && current == request && !failed) loaded = true
    }
    fun onReady(token: String, current: PlaybackRequest?) {
        if (token == loadToken && current == request && !failed) ready = true
    }
    fun onReceiverPlayable(token: String, current: PlaybackRequest?) {
        if (token == loadToken && current == request && !failed) receiverReady = true
    }
    fun fail() { failed = true }
    fun rebind(previous: PlaybackRequest?, current: PlaybackRequest?) {
        if (request == previous && request != current) { request = current; receiverReady = false }
    }
}
