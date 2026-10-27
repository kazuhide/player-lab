package com.playerlab.android

import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.UiConfig
import org.json.JSONException
import org.json.JSONObject

/** Adds the host's UI-only preference after SDK overrides, preserving other Web UI options. */
internal fun liveRewindViewConfig(config: PlayerViewConfig, enabled: Boolean): PlayerViewConfig {
    val webUi = config.uiConfig as? UiConfig.WebUi ?: return config
    val options = if (webUi.customOptions.isNullOrBlank()) {
        "{\"playerLabLiveRewindEnabled\":$enabled}"
    } else try {
        JSONObject(webUi.customOptions).put("playerLabLiveRewindEnabled", enabled).toString()
    } catch (_: JSONException) {
        // Preserve the SDK's handling of invalid custom JSON rather than crashing the host Activity.
        return config
    }
    return config.copy(uiConfig = webUi.copy(customOptions = options))
}
