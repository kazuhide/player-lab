package com.playerlab.android

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
    fun run(action: () -> Unit) {
        result = runCatching { action(); "Analytics SSAI signal submitted. Check the matching Dashboard session." }
            .getOrElse { "Analytics SSAI API failed (${it.javaClass.simpleName}). Check metadata types and collector state." }
    }
    Text("Analytics SSAI signals", style = MaterialTheme.typography.titleSmall)
    Text("These commands report stitched-ad transitions to the collector. Send them at the actual ad transitions in a compatible stream. Ad position accepts PREROLL, MIDROLL or POSTROLL; counts and durationInMs are nonnegative whole numbers, and isSlate is true or false.", style = MaterialTheme.typography.bodySmall)
    AnalyticsMetadataEditor("SSAI metadata", "analytics-ssai", ssaiMetadataKeys, values) { values = it }
    Button(onClick = { run { requireNotNull(controller.player.analytics).ssai.adBreakStart(analyticsAdBreakMetadata(values)) } }, modifier = Modifier.testTag("analytics-ssai-break-start")) { Text("Signal ad break start") }
    Button(onClick = { run { requireNotNull(controller.player.analytics).ssai.adStart(analyticsAdMetadata(values)) } }, modifier = Modifier.testTag("analytics-ssai-ad-start")) { Text("Signal ad start") }
    SsaiAdQuartile.entries.forEach { quartile ->
        Button(onClick = { run {
            val metadata = AdQuartileMetadata.Builder().apply { values["failedBeaconUrl"]?.let(::setFailedBeaconUrl) }.build()
            requireNotNull(controller.player.analytics).ssai.adQuartileFinished(quartile, metadata)
        } }) { Text("Signal ${quartile.name} quartile") }
    }
    Button(onClick = { run { requireNotNull(controller.player.analytics).ssai.adBreakEnd() } }, modifier = Modifier.testTag("analytics-ssai-break-end")) { Text("Signal ad break end") }
    Text(result, style = MaterialTheme.typography.bodySmall)
}
