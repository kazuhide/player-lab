package com.playerlab.android

import com.bitmovin.player.api.vr.orientation.OrientationProvider
import com.bitmovin.player.api.vr.orientation.ViewingDirection

/** A concrete host-owned provider for testing orientation without a device sensor. */
internal class ApiManualOrientation(private val direction: ViewingDirection, enabled: Boolean) : OrientationProvider {
    @Volatile private var enabled = enabled
    override fun enable() { enabled = true }
    override fun disable() { enabled = false }
    override fun isEnabled() = enabled
    override fun getViewingDirection() = direction
}

internal fun setApiOrientation(controller: PlayerController, provider: String, mode: String, direction: ViewingDirection, enabled: Boolean) {
    val vr = controller.player.vr
    require(provider in listOf("gyroscopic", "touch"))
    val current = if (provider == "gyroscopic") vr.gyroscopicOrientationProvider else vr.touchOrientationProvider
    if (!controller.apiOriginalOrientations.containsKey(provider)) controller.apiOriginalOrientations[provider] = current
    val selected = when (mode) {
        "Original" -> controller.apiOriginalOrientations[provider]
        "Manual" -> ApiManualOrientation(direction, enabled)
        "None" -> null
        else -> error("Choose an orientation provider mode.")
    }
    if (provider == "gyroscopic") vr.gyroscopicOrientationProvider = selected else vr.touchOrientationProvider = selected
}
