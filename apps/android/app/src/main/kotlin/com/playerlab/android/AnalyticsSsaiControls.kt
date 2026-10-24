package com.playerlab.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.bitmovin.analytics.api.ads.AdBreakMetadata
import com.bitmovin.analytics.api.ads.AdMetadata
import com.bitmovin.analytics.api.ads.AdQuartileMetadata
import com.bitmovin.analytics.api.ssai.SsaiAdPosition
import com.bitmovin.analytics.api.ssai.SsaiAdQuartile
import com.bitmovin.player.api.analytics.AnalyticsApi.Companion.analytics

internal val ssaiMetadataKeys = listOf("adPosition", "expectedPaidAds", "expectedSlates", "adId", "adSystem",
    "universalAdIdValue", "universalAdIdRegistry", "creativeId", "creativeAdId", "advertiserName", "title",
    "isSlate", "durationInMs", "failedBeaconUrl") + analyticsCustomKeys

internal fun analyticsAdBreakMetadata(values: Map<String, String>): AdBreakMetadata = AdBreakMetadata.Builder().apply {
    validateAnalyticsMetadata(values, ssaiMetadataKeys)
    values["adPosition"]?.let { setAdPosition(SsaiAdPosition.valueOf(it)) }
    values["expectedPaidAds"]?.let { setExpectedPaidAds(it.toInt().also { number -> require(number >= 0) }) }
    values["expectedSlates"]?.let { setExpectedSlates(it.toInt().also { number -> require(number >= 0) }) }
}.build()

internal fun analyticsAdMetadata(values: Map<String, String>): AdMetadata = AdMetadata.Builder().apply {
    validateAnalyticsMetadata(values, ssaiMetadataKeys)
    values["adId"]?.let(::setAdId); values["adSystem"]?.let(::setAdSystem)
    values["universalAdIdValue"]?.let(::setUniversalAdIdValue); values["universalAdIdRegistry"]?.let(::setUniversalAdIdRegistry)
    values["creativeId"]?.let(::setCreativeId); values["creativeAdId"]?.let(::setCreativeAdId)
    values["advertiserName"]?.let(::setAdvertiserName); values["title"]?.let(::setTitle)
    values["isSlate"]?.let { setIsSlate(it.toBooleanStrict()) }
    values["durationInMs"]?.let { setDurationInMs(it.toLong().also { number -> require(number >= 0) }) }
    setCustomData(analyticsCustomData(values.filterKeys { it in analyticsCustomKeys }))
}.build()

@Composable
internal fun AnalyticsSsaiControls(controller: PlayerController) {
    var values by remember { mutableStateOf(emptyMap<String, String>()) }
    var result by remember(controller.player) { mutableStateOf("") }
    var signal by remember { mutableStateOf("analytics-ssai-break-start") }
    val metadata = remember { AnalyticsMetadataState(ssaiMetadataKeys.first()) }
    val signals = listOf("analytics-ssai-break-start" to "Signal ad break start", "analytics-ssai-ad-start" to "Signal ad start") +
        SsaiAdQuartile.entries.map { "analytics-ssai-quartile-${it.name}" to "Signal ${it.name} quartile" } +
        listOf("analytics-ssai-break-end" to "Signal ad break end")
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(!workspaceKeyboardEditing()) {
            WorkspacePicker("SSAI signal", signal, signals, "analytics-ssai-signal", compact = true,
                modifier = Modifier.padding(horizontal = 12.dp)) { signal = it }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AnalyticsMetadataEditor("SSAI metadata", "analytics-ssai", ssaiMetadataKeys, values, state = metadata) { values = it }
            UiText("Report stitched-ad transitions at actual ad boundaries. Inspect the matching Bitmovin Dashboard session to confirm ingestion. Ad position is PREROLL, MIDROLL or POSTROLL; counts and durationInMs are nonnegative whole numbers; isSlate is true or false.", style = MaterialTheme.typography.bodySmall)
            if (result.isNotEmpty()) UiText(result, style = MaterialTheme.typography.bodySmall)
        }
        Surface(tonalElevation = 2.dp) {
            Button(onClick = {
                result = runCatching {
                    val ssai = requireNotNull(controller.player.analytics).ssai
                    when (signal) {
                        "analytics-ssai-break-start" -> ssai.adBreakStart(analyticsAdBreakMetadata(values))
                        "analytics-ssai-ad-start" -> ssai.adStart(analyticsAdMetadata(values))
                        "analytics-ssai-break-end" -> ssai.adBreakEnd()
                        else -> {
                            val quartile = SsaiAdQuartile.valueOf(signal.removePrefix("analytics-ssai-quartile-"))
                            val metadata = AdQuartileMetadata.Builder().apply { values["failedBeaconUrl"]?.let(::setFailedBeaconUrl) }.build()
                            ssai.adQuartileFinished(quartile, metadata)
                        }
                    }
                    "Analytics SSAI signal submitted. Check the matching Dashboard session."
                }.getOrElse { "Analytics SSAI API failed (${it.javaClass.simpleName}). Check metadata types and collector state." }
            }, modifier = Modifier.fillMaxWidth().padding(12.dp).testTag(signal)) { UiText(signals.first { it.first == signal }.second) }
        }
    }
}
