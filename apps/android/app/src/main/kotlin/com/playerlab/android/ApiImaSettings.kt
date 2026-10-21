package com.playerlab.android

import com.bitmovin.player.api.advertising.ima.*

internal object ApiImaSettings {
    private const val SDK = "android:com.bitmovin.player.api."
    private fun elements(value: String) = if (value == "null") null else if (value.isEmpty()) emptyList() else value.split(',').map { ImaUiElement.valueOf(it) }
    private fun elementsCode(value: String) = elements(value)?.joinToString(", ", "listOf(", ")") { "ImaUiElement.${it.name}" } ?: "null"
    val fields = listOf(
        ApiSetting(SDK + "advertising.AdvertisingConfig.enableGaplessAdPlayback", "AdvertisingConfig", ApiValueKind.Boolean, "Experimental gapless playback for supported client-side ad workflows. Requires compatible ad media and the advertising integration.",
            player = { c, v -> c.copy(advertisingConfig = c.advertisingConfig.copy(enableGaplessAdPlayback = v.toBooleanStrict())) }, code = { v -> "playerConfig = playerConfig.copy(advertisingConfig = playerConfig.advertisingConfig.copy(enableGaplessAdPlayback = $v))" }),
        ApiSetting(SDK + "advertising.ima.ImaConfig.preferredUiType", "ImaConfig", ApiValueKind.Choice, "Choose the preferred IMA UI rendering behavior. Takes effect when the IMA advertising module initializes.", choices = ImaUiType.entries.map { it.name },
            player = { c, v -> c.copy(advertisingConfig = c.advertisingConfig.copy(ima = c.advertisingConfig.ima.copy(preferredUiType = ImaUiType.valueOf(v)))) }, code = { v -> "playerConfig = playerConfig.copy(advertisingConfig = playerConfig.advertisingConfig.copy(ima = playerConfig.advertisingConfig.ima.copy(preferredUiType = ImaUiType.$v)))" }),
        ApiSetting(SDK + "advertising.ima.ImaConfig.preferredUiElements", "ImaConfig", ApiValueKind.TextList, "Comma-separated IMA UI elements. Blank requests no preferred elements; null leaves the preference unset. Do not combine with the deprecated imaUiElements alias.", choices = ImaUiElement.entries.map { it.name }, nullable = true,
            player = { c, v -> c.copy(advertisingConfig = c.advertisingConfig.copy(ima = c.advertisingConfig.ima.copy(preferredUiElements = elements(v)))) }, code = { v -> "playerConfig = playerConfig.copy(advertisingConfig = playerConfig.advertisingConfig.copy(ima = playerConfig.advertisingConfig.ima.copy(preferredUiElements = ${elementsCode(v)})))" }),
        ApiSetting(SDK + "advertising.AdvertisingConfig.imaUiElements", "AdvertisingConfig", ApiValueKind.TextList, "Deprecated alias for IMA UI element preferences. Use one alias at a time. Blank is an empty list and null clears the preference.", choices = ImaUiElement.entries.map { it.name }, nullable = true,
            player = { c, v -> c.copy(advertisingConfig = c.advertisingConfig.copy(imaUiElements = elements(v))) }, code = { v -> "playerConfig = playerConfig.copy(advertisingConfig = playerConfig.advertisingConfig.copy(imaUiElements = ${elementsCode(v)}))" }),
    )
}
