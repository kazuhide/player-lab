package com.playerlab.android

import com.bitmovin.analytics.api.*
import com.bitmovin.analytics.api.error.AnalyticsError
import com.bitmovin.analytics.api.error.ErrorTransformerCallback
import com.bitmovin.player.api.analytics.AnalyticsPlayerConfig

internal val analyticsCustomKeys = (1..100).map { "customData$it" } + "experimentName"
internal val analyticsDefaultKeys = listOf("cdnProvider", "customUserId") + analyticsCustomKeys
internal val analyticsSourceKeys = listOf("title", "videoId", "cdnProvider", "path", "isLive") + analyticsCustomKeys

internal fun validateAnalyticsMetadata(values: Map<String, String>, keys: List<String>) {
    require(values.keys.all { it in keys }) { "Use a documented Analytics metadata field." }
    require(values.values.all { it.length <= 8192 }) { "Metadata values are limited to 8192 characters." }
    values["isLive"]?.toBooleanStrict()
}

/** Every custom field is bound to its concrete SDK constructor parameter. */
internal fun analyticsCustomData(values: Map<String, String>): CustomData {
    validateAnalyticsMetadata(values, analyticsCustomKeys)
    return CustomData(
        customData1 = values["customData1"],
        customData2 = values["customData2"],
        customData3 = values["customData3"],
        customData4 = values["customData4"],
        customData5 = values["customData5"],
        customData6 = values["customData6"],
        customData7 = values["customData7"],
        customData8 = values["customData8"],
        customData9 = values["customData9"],
        customData10 = values["customData10"],
        customData11 = values["customData11"],
        customData12 = values["customData12"],
        customData13 = values["customData13"],
        customData14 = values["customData14"],
        customData15 = values["customData15"],
        customData16 = values["customData16"],
        customData17 = values["customData17"],
        customData18 = values["customData18"],
        customData19 = values["customData19"],
        customData20 = values["customData20"],
        customData21 = values["customData21"],
        customData22 = values["customData22"],
        customData23 = values["customData23"],
        customData24 = values["customData24"],
        customData25 = values["customData25"],
        customData26 = values["customData26"],
        customData27 = values["customData27"],
        customData28 = values["customData28"],
        customData29 = values["customData29"],
        customData30 = values["customData30"],
        customData31 = values["customData31"],
        customData32 = values["customData32"],
        customData33 = values["customData33"],
        customData34 = values["customData34"],
        customData35 = values["customData35"],
        customData36 = values["customData36"],
        customData37 = values["customData37"],
        customData38 = values["customData38"],
        customData39 = values["customData39"],
        customData40 = values["customData40"],
        customData41 = values["customData41"],
        customData42 = values["customData42"],
        customData43 = values["customData43"],
        customData44 = values["customData44"],
        customData45 = values["customData45"],
        customData46 = values["customData46"],
        customData47 = values["customData47"],
        customData48 = values["customData48"],
        customData49 = values["customData49"],
        customData50 = values["customData50"],
        customData51 = values["customData51"],
        customData52 = values["customData52"],
        customData53 = values["customData53"],
        customData54 = values["customData54"],
        customData55 = values["customData55"],
        customData56 = values["customData56"],
        customData57 = values["customData57"],
        customData58 = values["customData58"],
        customData59 = values["customData59"],
        customData60 = values["customData60"],
        customData61 = values["customData61"],
        customData62 = values["customData62"],
        customData63 = values["customData63"],
        customData64 = values["customData64"],
        customData65 = values["customData65"],
        customData66 = values["customData66"],
        customData67 = values["customData67"],
        customData68 = values["customData68"],
        customData69 = values["customData69"],
        customData70 = values["customData70"],
        customData71 = values["customData71"],
        customData72 = values["customData72"],
        customData73 = values["customData73"],
        customData74 = values["customData74"],
        customData75 = values["customData75"],
        customData76 = values["customData76"],
        customData77 = values["customData77"],
        customData78 = values["customData78"],
        customData79 = values["customData79"],
        customData80 = values["customData80"],
        customData81 = values["customData81"],
        customData82 = values["customData82"],
        customData83 = values["customData83"],
        customData84 = values["customData84"],
        customData85 = values["customData85"],
        customData86 = values["customData86"],
        customData87 = values["customData87"],
        customData88 = values["customData88"],
        customData89 = values["customData89"],
        customData90 = values["customData90"],
        customData91 = values["customData91"],
        customData92 = values["customData92"],
        customData93 = values["customData93"],
        customData94 = values["customData94"],
        customData95 = values["customData95"],
        customData96 = values["customData96"],
        customData97 = values["customData97"],
        customData98 = values["customData98"],
        customData99 = values["customData99"],
        customData100 = values["customData100"],
        experimentName = values["experimentName"],
    )
}

internal fun analyticsCustomDataValues(value: CustomData): Map<String, String> = listOf(
    "customData1" to value.customData1,
    "customData2" to value.customData2,
    "customData3" to value.customData3,
    "customData4" to value.customData4,
    "customData5" to value.customData5,
    "customData6" to value.customData6,
    "customData7" to value.customData7,
    "customData8" to value.customData8,
    "customData9" to value.customData9,
    "customData10" to value.customData10,
    "customData11" to value.customData11,
    "customData12" to value.customData12,
    "customData13" to value.customData13,
    "customData14" to value.customData14,
    "customData15" to value.customData15,
    "customData16" to value.customData16,
    "customData17" to value.customData17,
    "customData18" to value.customData18,
    "customData19" to value.customData19,
    "customData20" to value.customData20,
    "customData21" to value.customData21,
    "customData22" to value.customData22,
    "customData23" to value.customData23,
    "customData24" to value.customData24,
    "customData25" to value.customData25,
    "customData26" to value.customData26,
    "customData27" to value.customData27,
    "customData28" to value.customData28,
    "customData29" to value.customData29,
    "customData30" to value.customData30,
    "customData31" to value.customData31,
    "customData32" to value.customData32,
    "customData33" to value.customData33,
    "customData34" to value.customData34,
    "customData35" to value.customData35,
    "customData36" to value.customData36,
    "customData37" to value.customData37,
    "customData38" to value.customData38,
    "customData39" to value.customData39,
    "customData40" to value.customData40,
    "customData41" to value.customData41,
    "customData42" to value.customData42,
    "customData43" to value.customData43,
    "customData44" to value.customData44,
    "customData45" to value.customData45,
    "customData46" to value.customData46,
    "customData47" to value.customData47,
    "customData48" to value.customData48,
    "customData49" to value.customData49,
    "customData50" to value.customData50,
    "customData51" to value.customData51,
    "customData52" to value.customData52,
    "customData53" to value.customData53,
    "customData54" to value.customData54,
    "customData55" to value.customData55,
    "customData56" to value.customData56,
    "customData57" to value.customData57,
    "customData58" to value.customData58,
    "customData59" to value.customData59,
    "customData60" to value.customData60,
    "customData61" to value.customData61,
    "customData62" to value.customData62,
    "customData63" to value.customData63,
    "customData64" to value.customData64,
    "customData65" to value.customData65,
    "customData66" to value.customData66,
    "customData67" to value.customData67,
    "customData68" to value.customData68,
    "customData69" to value.customData69,
    "customData70" to value.customData70,
    "customData71" to value.customData71,
    "customData72" to value.customData72,
    "customData73" to value.customData73,
    "customData74" to value.customData74,
    "customData75" to value.customData75,
    "customData76" to value.customData76,
    "customData77" to value.customData77,
    "customData78" to value.customData78,
    "customData79" to value.customData79,
    "customData80" to value.customData80,
    "customData81" to value.customData81,
    "customData82" to value.customData82,
    "customData83" to value.customData83,
    "customData84" to value.customData84,
    "customData85" to value.customData85,
    "customData86" to value.customData86,
    "customData87" to value.customData87,
    "customData88" to value.customData88,
    "customData89" to value.customData89,
    "customData90" to value.customData90,
    "customData91" to value.customData91,
    "customData92" to value.customData92,
    "customData93" to value.customData93,
    "customData94" to value.customData94,
    "customData95" to value.customData95,
    "customData96" to value.customData96,
    "customData97" to value.customData97,
    "customData98" to value.customData98,
    "customData99" to value.customData99,
    "customData100" to value.customData100,
    "experimentName" to value.experimentName,
).mapNotNull { (key, entry) -> entry?.let { key to it } }.toMap()

internal fun analyticsSourceMetadata(values: Map<String, String>): SourceMetadata {
    validateAnalyticsMetadata(values, analyticsSourceKeys)
    return SourceMetadata(
        title = values["title"], videoId = values["videoId"], cdnProvider = values["cdnProvider"],
        path = values["path"], isLive = values["isLive"]?.toBooleanStrict(),
        customData = analyticsCustomData(values.filterKeys { it in analyticsCustomKeys }),
    )
}
internal fun analyticsMetadataValues(value: SourceMetadata): Map<String, Any?> = mapOf(
    "title" to value.title, "videoId" to value.videoId, "cdnProvider" to value.cdnProvider,
    "path" to value.path, "isLive" to value.isLive, "customData" to analyticsCustomDataValues(value.customData),
)

internal data class ApiAnalyticsSettings(
    val mode: String = "Build key",
    val licenseOverride: String = "",
    val adTrackingDisabled: Boolean = false,
    val randomizeUserId: Boolean = false,
    val retryPolicy: RetryPolicy = RetryPolicy.NO_RETRY,
    val backendUrl: String = "",
    val logLevel: LogLevel = LogLevel.ERROR,
    val ssaiEngagementTracking: Boolean = true,
    val errorStrategy: String = "Default",
    val defaults: Map<String, String> = emptyMap(),
    val source: Map<String, String> = emptyMap(),
    val errorCallbackBody: String = "return {code: input.code, message: 'Player Lab error', severity: input.severity};",
) {
    fun playerConfig(buildKey: String, callbacks: ApiCallbackContext = ApiCallbackContext()): AnalyticsPlayerConfig {
        require(mode in listOf("Build key", "Deferred license", "Disabled"))
        validateAnalyticsMetadata(defaults, analyticsDefaultKeys)
        sourceMetadata()
        if (mode == "Disabled") return AnalyticsPlayerConfig.Disabled
        val key = licenseOverride.ifBlank { if (mode == "Deferred license") "DEFERRED" else buildKey }
        if (key.isEmpty()) return AnalyticsPlayerConfig.Disabled
        val config = AnalyticsConfig.Builder(key)
            .setAdTrackingDisabled(adTrackingDisabled).setRandomizeUserId(randomizeUserId)
            .setRetryPolicy(retryPolicy).setLogLevel(logLevel)
            .setSsaiEngagementTrackingEnabled(ssaiEngagementTracking)
            .setErrorTransformerCallback(when (errorStrategy) {
                "Default" -> null
                "Redact message" -> ErrorTransformerCallback { error, _ -> AnalyticsError(error.code, "Player Lab error details omitted", error.severity) }
                "Custom" -> ApiAnalyticsErrorScripts.callback(errorCallbackBody, callbacks)
                else -> error("Choose a documented error transformation strategy.")
            }).apply {
                if (backendUrl.isNotBlank()) {
                    val uri = java.net.URI(backendUrl)
                    require(uri.scheme in listOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null) { "Use an HTTP or HTTPS Analytics endpoint without user information." }
                    setBackendUrl(backendUrl)
                }
            }.build()
        return AnalyticsPlayerConfig.Enabled(config, DefaultMetadata(
            cdnProvider = defaults["cdnProvider"], customUserId = defaults["customUserId"],
            customData = analyticsCustomData(defaults.filterKeys { it in analyticsCustomKeys }),
        ))
    }
    fun sourceMetadata(): SourceMetadata = analyticsSourceMetadata(source)
    fun code(): String {
        fun custom(values: Map<String, String>) = values.filterKeys { it in analyticsCustomKeys }.entries
            .joinToString(", ", "CustomData(", ")") { "${it.key} = ${kotlinString(it.value)}" }
        val sourceArgs = source.filterKeys { it !in analyticsCustomKeys }.map { (key, value) -> "$key = ${if (key == "isLive") value else kotlinString(value)}" } + "customData = ${custom(source)}"
        val sourceCode = "val analyticsSourceConfig = AnalyticsSourceConfig.Enabled(SourceMetadata(${sourceArgs.joinToString(", ")}))"
        if (mode == "Disabled") return "val analyticsConfig = AnalyticsPlayerConfig.Disabled\n$sourceCode"
        val license = if (mode == "Deferred license" && licenseOverride.isBlank()) "DEFERRED" else "YOUR_ANALYTICS_LICENSE_KEY"
        val args = listOf("licenseKey = ${kotlinString(license)}", "adTrackingDisabled = $adTrackingDisabled", "randomizeUserId = $randomizeUserId", "retryPolicy = RetryPolicy.${retryPolicy.name}", "logLevel = LogLevel.${logLevel.name}", "ssaiEngagementTrackingEnabled = $ssaiEngagementTracking") +
            (if (backendUrl.isNotBlank()) listOf("backendUrl = ${kotlinString(backendUrl)}") else emptyList()) +
            if (errorStrategy == "Custom") listOf("errorTransformerCallback = ApiAnalyticsErrorScripts.callback(\"<YOUR_CALLBACK_BODY>\", callbackContext)") else if (errorStrategy == "Redact message") listOf("errorTransformerCallback = com.bitmovin.analytics.api.error.ErrorTransformerCallback { error, _ -> com.bitmovin.analytics.api.error.AnalyticsError(error.code, \"Player Lab error details omitted\", error.severity) }") else emptyList()
        val defaultArgs = defaults.filterKeys { it !in analyticsCustomKeys }.map { (key, value) -> "$key = ${kotlinString(value)}" } + "customData = ${custom(defaults)}"
        return """
            // Import com.bitmovin.analytics.api.* and com.bitmovin.player.api.analytics.*.
            ${if (errorStrategy == "Custom") "val callbackContext = ApiCallbackContext()" else ""}
            val analyticsConfig = AnalyticsPlayerConfig.Enabled(
                analyticsConfig = AnalyticsConfig(${args.joinToString(", ")}),
                defaultMetadata = DefaultMetadata(${defaultArgs.joinToString(", ")}),
            )
            $sourceCode
        """.trimIndent()
    }
}
