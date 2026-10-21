package com.playerlab.android

import com.bitmovin.player.api.*
import com.bitmovin.player.api.live.*
import com.bitmovin.player.api.source.*
import com.bitmovin.player.api.ui.*

private const val SDK = "android:com.bitmovin.player.api."
private fun integers(value: String) = if (value.isBlank()) emptyList() else value.split(',').map(String::toInt)
private fun strings(value: String) = if (value.isEmpty()) emptyList() else value.split(',').map(String::trim)
private fun devices(value: String): List<DeviceDescription> = parseApiStringMap(value).map { (key, name) ->
    when (key.substringBefore('.')) {
        "model" -> DeviceDescription.ModelName(name)
        "device" -> DeviceDescription.DeviceName(name)
        else -> error("Use model.index or device.index for device-list keys.")
    }
}
private fun devicesCode(value: String) = devices(value).joinToString(", ", "listOf(", ")") {
    when (it) {
        is DeviceDescription.ModelName -> "DeviceDescription.ModelName(${kotlinString(it.name)})"
        is DeviceDescription.DeviceName -> "DeviceDescription.DeviceName(${kotlinString(it.name)})"
    }
}
private fun synchronization(value: String) = parseApiStringMap(value).map { (key, source) ->
    SynchronizationConfigEntry(source, LiveSynchronizationMethod.valueOf(key.substringBefore('.')))
}
private fun synchronizationCode(value: String) = synchronization(value).joinToString(", ", "listOf(", ")") {
    "SynchronizationConfigEntry(source = ${kotlinString(it.source)}, method = LiveSynchronizationMethod.${it.method.name})"
}
private fun synchronizationValues(value: String, legacy: Boolean): Map<String, String> = parseApiStringMap(value).also { entries ->
    require(entries.keys.all { it in if (legacy) listOf("playbackRate", "seekThreshold", "playbackRateThreshold") else listOf("playbackRate", "seekThreshold") }) { "Use documented synchronization fields." }
    entries.forEach { (key, raw) ->
        if (key == "playbackRate") require(raw.toFloatOrNull()?.let { it.isFinite() && it > 0f } == true) { "Playback rate must be a positive finite float." }
        else require(raw == "Infinity" || raw.toDoubleOrNull()?.let { it.isFinite() && it >= 0 } == true) { "Thresholds must be nonnegative numbers or Infinity." }
    }
}
private fun targetSync(value: String, base: TargetSynchronizationConfig): TargetSynchronizationConfig {
    val values = synchronizationValues(value, false)
    return base.copy(playbackRate = values["playbackRate"]?.toFloat() ?: base.playbackRate,
        seekThreshold = values["seekThreshold"]?.toDouble() ?: base.seekThreshold)
}
private fun legacySync(value: String, base: LowLatencySynchronizationConfig): LowLatencySynchronizationConfig {
    val values = synchronizationValues(value, true)
    return base.copy(playbackRate = values["playbackRate"]?.toFloat() ?: base.playbackRate,
        seekThreshold = values["seekThreshold"]?.toDouble() ?: base.seekThreshold,
        playbackRateThreshold = values["playbackRateThreshold"]?.toDouble() ?: base.playbackRateThreshold)
}
private fun syncArguments(value: String, legacy: Boolean) = synchronizationValues(value, legacy).entries.joinToString(", ") { (key, raw) ->
    "$key = ${if (key == "playbackRate") "${raw.toFloat()}f" else if (raw == "Infinity") "Double.POSITIVE_INFINITY" else raw.toDouble()}"
}

internal object ApiStructuredSettings {
    val fields = listOf(
        ApiSetting(SDK + "PlayerConfig.key", "PlayerConfig", ApiValueKind.Text,
            "Session-only Player key override. The value is hidden and exported as a placeholder. Removing it restores the build key.", secret = true,
            player = { c, v -> c.copy(key = v) }, code = { "playerConfig = playerConfig.copy(key = \"YOUR_PLAYER_LICENSE_KEY\")" }),
        ApiSetting(SDK + "ui.PlayerViewConfig.uiConfig", "PlayerViewConfig", ApiValueKind.Choice,
            "Choose WebUi or Disabled. Remove Web UI field overrides before choosing Disabled.", choices = listOf("WebUi", "Disabled"), order = 0,
            view = { c, v -> c.copy(uiConfig = if (v == "Disabled") UiConfig.Disabled else c.uiConfig as? UiConfig.WebUi ?: UiConfig.WebUi()) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ${if (v == "Disabled") "UiConfig.Disabled" else "(playerViewConfig.uiConfig as? UiConfig.WebUi ?: UiConfig.WebUi())"})" }),
        ApiSetting(SDK + "source.SourceConfig.cmcdConfig", "SourceConfig", ApiValueKind.Choice,
            "Choose Enabled or Disabled. Remove enabled-field overrides when disabling CMCD.", choices = listOf("Enabled", "Disabled"), order = 0,
            source = { c, v -> c.cmcdConfig = when (v) { "Disabled" -> CmcdConfig.Disabled; else -> c.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled() } },
            code = { v -> "sourceConfig.cmcdConfig = ${when (v) { "Disabled" -> "CmcdConfig.Disabled"; else -> "(sourceConfig.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled())" }}" }),
        ApiSetting(SDK + "source.SourceConfig.drmConfig", "SourceConfig", ApiValueKind.Choice,
            "Select a DRM variant, or None. Configure its license and variant fields separately. Remove incompatible variant fields first.", choices = listOf("None", "Widevine", "PlayReady", "NagraConnect", "ClearKey"), drmParameter = true),
        ApiSetting(SDK + "TweaksConfig.bandwidthMeterType", "TweaksConfig", ApiValueKind.Choice,
            "Select the bandwidth estimator variant. Variant-specific values remain editable separately.", choices = listOf("Default", "Experimental"), order = 0,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = if (v == "Default") c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Default ?: BandwidthMeterType.Default() else c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = (playerConfig.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.$v ?: BandwidthMeterType.$v())))" }),
        ApiSetting(SDK + "BandwidthMeterType.Experimental.bandwidthEstimationMode", "BandwidthMeterType.Experimental", ApiValueKind.Choice,
            "Choose the experimental estimation algorithm. Its numeric fields remain separate overrides.", choices = listOf("ExponentialWeightedAverage", "SlidingPercentile"), order = 1,
            player = { c, v -> val base = c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental(); c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = base.copy(bandwidthEstimationMode = if (v == "SlidingPercentile") base.bandwidthEstimationMode as? BandwidthEstimationMode.SlidingPercentile ?: BandwidthEstimationMode.SlidingPercentile() else base.bandwidthEstimationMode as? BandwidthEstimationMode.ExponentialWeightedAverage ?: BandwidthEstimationMode.ExponentialWeightedAverage()))) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = (playerConfig.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).copy(bandwidthEstimationMode = BandwidthEstimationMode.$v())))" }),
        ApiSetting(SDK + "TweaksConfig.devicesThatRequireSurfaceWorkaround", "TweaksConfig", ApiValueKind.StringMap,
            "One model.index=name or device.index=name per line, for example model.1=ModelName. Blank clears the list. Keys distinguish entries of the same type.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(devicesThatRequireSurfaceWorkaround = devices(v))) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(devicesThatRequireSurfaceWorkaround = ${devicesCode(v)}))" }),
        ApiSetting(SDK + "DeviceDescription.ModelName.name", "DeviceDescription.ModelName", ApiValueKind.TextList,
            "Comma-separated model names. Replaces model entries while retaining device-name entries. Use the full device-list editor for names containing commas.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(devicesThatRequireSurfaceWorkaround = c.tweaksConfig.devicesThatRequireSurfaceWorkaround.filterNot { it is DeviceDescription.ModelName } + strings(v).map { DeviceDescription.ModelName(it) })) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(devicesThatRequireSurfaceWorkaround = playerConfig.tweaksConfig.devicesThatRequireSurfaceWorkaround.filterNot { it is DeviceDescription.ModelName } + ${strings(v).joinToString(", ", "listOf(", ")") { "DeviceDescription.ModelName(${kotlinString(it)})" }}))" }),
        ApiSetting(SDK + "DeviceDescription.DeviceName.name", "DeviceDescription.DeviceName", ApiValueKind.TextList,
            "Comma-separated device names. Replaces device entries while retaining model-name entries. Use the full device-list editor for names containing commas.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(devicesThatRequireSurfaceWorkaround = c.tweaksConfig.devicesThatRequireSurfaceWorkaround.filterNot { it is DeviceDescription.DeviceName } + strings(v).map { DeviceDescription.DeviceName(it) })) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(devicesThatRequireSurfaceWorkaround = playerConfig.tweaksConfig.devicesThatRequireSurfaceWorkaround.filterNot { it is DeviceDescription.DeviceName } + ${strings(v).joinToString(", ", "listOf(", ")") { "DeviceDescription.DeviceName(${kotlinString(it)})" }}))" }),
        ApiSetting(SDK + "LoadErrorFallbackConfig.HttpStatusCode.statusCodes", "LoadErrorFallbackConfig.HttpStatusCode", ApiValueKind.IntegerList,
            "Comma-separated HTTP status codes that permit a fallback resource. Blank uses an empty list. Availability of an alternate resource still depends on the stream.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(loadErrorFallbackConfig = LoadErrorFallbackConfig.HttpStatusCode(integers(v)))) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(loadErrorFallbackConfig = LoadErrorFallbackConfig.HttpStatusCode(listOf($v))))" }),
        ApiSetting(SDK + "media.AdaptationConfig.startupBitrate", "AdaptationConfig", ApiValueKind.Integer,
            "Deprecated alias for the initial bandwidth estimate, in bits per second. -1 restores no estimate override. Do not combine with the newer initialBandwidthEstimateOverride field.",
            player = { c, v -> c.copy(adaptationConfig = c.adaptationConfig.copy(initialBandwidthEstimateOverride = v.toInt().takeUnless { it == -1 }?.toLong())) },
            code = { v -> "playerConfig = playerConfig.copy(adaptationConfig = playerConfig.adaptationConfig.copy(initialBandwidthEstimateOverride = ${if (v == "-1") "null" else "${v}L"}))" }),
        ApiSetting(SDK + "live.LiveConfig.synchronization", "LiveConfig", ApiValueKind.StringMap,
            "One Ntp.index=server entry per line, for example Ntp.1=time.example.invalid. Blank clears the endpoint list.",
            player = { c, v -> c.copy(liveConfig = c.liveConfig.copy(synchronization = synchronization(v))) },
            code = { v -> "playerConfig = playerConfig.copy(liveConfig = playerConfig.liveConfig.copy(synchronization = ${synchronizationCode(v)}))" }),
        ApiSetting(SDK + "live.LiveConfig.lowLatencyConfig", "LiveConfig", ApiValueKind.Choice,
            "Legacy low-latency config. Enabled forces legacy live streams into low-latency handling; source live settings take precedence.", choices = listOf("Enabled", "null"), order = 0,
            player = { c, v -> c.copy(liveConfig = c.liveConfig.copy(lowLatencyConfig = if (v == "null") null else c.liveConfig.lowLatencyConfig ?: LowLatencyConfig())) },
            code = { v -> "playerConfig = playerConfig.copy(liveConfig = playerConfig.liveConfig.copy(lowLatencyConfig = ${if (v == "null") "null" else "(playerConfig.liveConfig.lowLatencyConfig ?: LowLatencyConfig())"}))" }),
        ApiSetting(SDK + "live.SourceLiveConfig.minTimeShiftBufferDepth", "SourceLiveConfig", ApiValueKind.Decimal,
            "Minimum available live buffer depth for time shifting, in seconds. SDK default is -40. This is ignored for on-demand sources.",
            source = { c, v -> c.liveConfig = (c.liveConfig ?: SourceLiveConfig()).copy(minTimeShiftBufferDepth = v.toDouble()) },
            code = { v -> "sourceConfig.liveConfig = (sourceConfig.liveConfig ?: SourceLiveConfig()).copy(minTimeShiftBufferDepth = $v)" }),
    ) + listOf(false, true).flatMap { fallback ->
        val member = if (fallback) "fallbackConfig" else "catchupConfig"
        listOf(
            ApiSetting(SDK + "live.LowLatencyConfig.$member", "LowLatencyConfig", ApiValueKind.StringMap,
                "One field=value per line: playbackRate (positive float), seekThreshold (seconds or Infinity), playbackRateThreshold (legacy threshold, ignored by this SDK). Omitted fields keep the current config.",
                player = { c, v -> val base = c.liveConfig.lowLatencyConfig ?: LowLatencyConfig(); val next = if (fallback) base.copy(fallbackConfig = legacySync(v, base.fallbackConfig)) else base.copy(catchupConfig = legacySync(v, base.catchupConfig)); c.copy(liveConfig = c.liveConfig.copy(lowLatencyConfig = next)) },
                code = { v -> "playerConfig = playerConfig.copy(liveConfig = playerConfig.liveConfig.copy(lowLatencyConfig = (playerConfig.liveConfig.lowLatencyConfig ?: LowLatencyConfig()).copy($member = (playerConfig.liveConfig.lowLatencyConfig ?: LowLatencyConfig()).$member.copy(${syncArguments(v, true)}))))" }),
            ApiSetting(SDK + "live.SourceLiveConfig.$member", "SourceLiveConfig", ApiValueKind.StringMap,
                "One field=value per line: playbackRate (positive float), seekThreshold (seconds or Infinity). Omitted fields keep the current config.",
                source = { c, v -> val base = c.liveConfig ?: SourceLiveConfig(); c.liveConfig = if (fallback) base.copy(fallbackConfig = targetSync(v, base.fallbackConfig)) else base.copy(catchupConfig = targetSync(v, base.catchupConfig)) },
                code = { v -> "sourceConfig.liveConfig = (sourceConfig.liveConfig ?: SourceLiveConfig()).copy($member = (sourceConfig.liveConfig ?: SourceLiveConfig()).$member.copy(${syncArguments(v, false)}))" }),
        )
    }
}
