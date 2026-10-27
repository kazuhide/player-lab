package com.playerlab.android

/** Current-session prerequisites, independent of SDK object construction and editor drafts. */
internal data class ApiCommandCapabilities(
    val playerAvailable: Boolean = true,
    val sourceAttached: Boolean = false,
    val sourceLoaded: Boolean = false,
    val isLive: Boolean = false,
    val liveRewindAvailable: Boolean = false,
    val casting: Boolean = false,
    val castAvailable: Boolean = false,
    val viewAttached: Boolean = false,
    val viewRecoverable: Boolean = false,
    val customMessageHandlerInstalled: Boolean = false,
    val nagraConfigured: Boolean = false,
    val gyroscopicProviderAvailable: Boolean = false,
    val touchProviderAvailable: Boolean = false,
    val fullscreen: Boolean = false,
    val pictureInPicture: Boolean = false,
    val pictureInPictureAvailable: Boolean = false,
    val activeAd: Boolean = false,
    val clientAdCallbacksAvailable: Boolean = false,
    val skippableAd: Boolean = false,
    val activeSsaiAd: Boolean = false,
    val activeSsaiBreak: Boolean = false,
    val hasSsaiAds: Boolean = false,
    val hasSsaiBreaks: Boolean = false,
    val playlistSize: Int = 0,
)

internal fun apiCommandUnavailableReason(id: String, state: ApiCommandCapabilities, manualSsai: Boolean,
    arguments: Map<String, String>? = null): String? {
    if (!state.playerAvailable) return "Player is unavailable."
    val member = id.substringAfterLast('.')
    if (id == "app:custom-message-send")
        return if (!state.customMessageHandlerInstalled) "Install the host message handler first." else null
    if (id.endsWith("Player.preloadDrmLicense()"))
        return if (!state.nagraConfigured) "Apply NagraConnect configuration first." else null
    if (id.endsWith("OrientationProvider.enable()") || id.endsWith("OrientationProvider.disable()")) {
        val available = when (arguments?.get("provider")) {
            "gyroscopic" -> state.gyroscopicProviderAvailable
            "touch" -> state.touchProviderAvailable
            else -> state.gyroscopicProviderAvailable || state.touchProviderAvailable
        }
        return if (!available) "The selected orientation provider is unavailable." else null
    }
    if (id == "app:ssai-ad" || ".ssai." in id) {
        if (!manualSsai) return "Enable manual SSAI integration for this source."
        if (!state.sourceAttached) return "Load a source first."
        if (state.casting) return "Unavailable during Cast playback."
        return when (member) {
            "startAd()" -> when {
                !state.activeSsaiBreak -> "Start an SSAI ad break first."
                !state.hasSsaiAds -> "Create SSAI ad metadata first."
                else -> null
            }
            "startAdBreak()", "registerAdBreaks()", "removeAdBreak()", "clearAdBreaks()" ->
                if (!state.hasSsaiBreaks) "Register an SSAI ad break first." else null
            "finishAd()", "reportAdQuartile()", "reportAdError()" ->
                if (!state.activeSsaiAd) "Requires an active SSAI ad." else null
            "finishAdBreak()" -> if (!state.activeSsaiBreak) "Requires an active SSAI ad break." else null
            "clickThroughUrlOpened()" -> if (!state.activeSsaiAd) "Requires an active SSAI ad." else null
            else -> null
        }
    }
    if (id.endsWith("Player.skipAd()") || id.endsWith("AdvertisingApi.skip()"))
        return if (!state.skippableAd) "Requires an active skippable ad." else null
    if (".advertising.Ad." in id)
        return if (!state.activeAd || !state.clientAdCallbacksAvailable) "Requires an active Bitmovin client-side ad." else null
    if (id.endsWith("Player.scheduleAd()") || id.endsWith("AdvertisingApi.schedule()"))
        return when {
            !state.sourceAttached -> "Load a source first."
            state.casting -> "Unavailable during Cast playback."
            else -> null
        }
    if (id.endsWith("RemoteControlApi.castVideo()"))
        return when {
            !state.sourceAttached -> "Load a source first."
            !state.castAvailable -> "No Cast receiver is available."
            state.casting -> "Cast playback is already active."
            else -> null
        }
    if (id.endsWith("RemoteControlApi.castStop()")) return if (!state.casting) "Requires active Cast playback." else null
    if (id.endsWith("Player.timeShift()")) return when {
        !state.sourceLoaded -> "Load a source first."
        !state.isLive || !state.liveRewindAvailable -> "Requires a live rewind window and SDK time shifting."
        else -> null
    }
    if (".live.LowLatencyApi." in id) return when {
        !state.sourceLoaded -> "Load a source first."
        !state.isLive -> "Requires a live source."
        else -> null
    }
    if (id.endsWith("Player.seek()")) return when {
        !state.sourceLoaded -> "Load a source first."
        state.isLive -> "Use timeShift for a live source."
        else -> null
    }
    if (".source.Source." in id || id.endsWith("Player.play()") || id.endsWith("Player.pause()") ||
        id.endsWith("Player.preload()") || id.endsWith("Player.unload()") || id.endsWith("Player.getThumbnail()") ||
        id.endsWith("Player.setAudio()") || id.endsWith("Player.setAudioQuality()") || id.endsWith("Player.setVideoQuality()") ||
        id.endsWith("Player.setSubtitle()") || id.endsWith("Player.removeSubtitle()"))
        return if (!state.sourceAttached) "Load a source first." else null
    if (".playlist.PlaylistApi." in id && member in listOf("remove()", "seek()"))
        return if (state.playlistSize == 0) "Add a playlist source first." else null
    if (".PlayerView." in id) {
        if (member == "player") return if (!state.viewRecoverable) "Create a PlayerView first." else null
        if (!state.viewAttached) return "Attach a player view first."
        return when (member) {
            "enterFullscreen()" -> if (state.fullscreen) "Fullscreen is already active." else null
            "exitFullscreen()" -> if (!state.fullscreen) "Requires fullscreen." else null
            "enterPictureInPicture()" -> when {
                state.pictureInPicture -> "Picture in Picture is already active."
                !state.pictureInPictureAvailable -> "Picture in Picture is unavailable."
                else -> null
            }
            "exitPictureInPicture()" -> if (!state.pictureInPicture) "Requires Picture in Picture." else null
            else -> null
        }
    }
    return null
}

/** Re-evaluate at dispatch time; a picker choice is not permission for a later playback session. */
internal inline fun <T> runAvailableApiCommand(id: String, state: ApiCommandCapabilities, manualSsai: Boolean,
    arguments: Map<String, String>? = null, execute: () -> T): T {
    check(apiCommandUnavailableReason(id, state, manualSsai, arguments) == null) { "This operation is unavailable in the current playback state." }
    return execute()
}
