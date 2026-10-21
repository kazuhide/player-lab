package com.playerlab.android

import com.bitmovin.player.api.drm.*
import com.bitmovin.player.api.source.SourceConfig

private const val DRM = "android:com.bitmovin.player.api.drm."
private const val DRM_VARIANT = "android:com.bitmovin.player.api.source.SourceConfig.drmConfig"
private fun drmStrategy(value: ByteArray, strategy: String): ByteArray = when (strategy) {
    "Identity" -> value
    "Base64Encode" -> android.util.Base64.encode(value, android.util.Base64.NO_WRAP)
    "Base64Decode" -> android.util.Base64.decode(value, android.util.Base64.DEFAULT)
    else -> error("Unknown DRM transformation strategy.")
}
private fun drmVariant(values: Map<String, String>): String {
    val variants = listOf("Widevine", "PlayReady", "NagraConnect").filter { variant -> values.keys.any { it.startsWith("${DRM}${variant}Config.") } } +
        if (values.keys.any { it.startsWith("${DRM}ClearKeyConfigEntry.") }) listOf("ClearKey") else emptyList()
    val selected = values[DRM_VARIANT]
    if (selected == "None") {
        require(values.size == 1) { "Remove DRM field overrides before selecting None." }
        return selected
    }
    require(variants.size <= 1) { "Use settings from one DRM variant at a time." }
    require(selected == null || variants.all { it == selected }) { "Remove field overrides from the other DRM variant." }
    return selected ?: variants.firstOrNull() ?: "Widevine"
}

/** Construct the whole DRM object once so input order cannot discard another field. */
internal fun configureApiDrm(source: SourceConfig, values: Map<String, String>) {
    if (values.isEmpty()) return
    fun value(name: String) = values[DRM + name]
    val variant = drmVariant(values)
    if (variant == "None") { source.drmConfig = null; return }
    val url = value("DrmConfig.licenseUrl") ?: source.drmConfig?.licenseUrl
    val headers = value("DrmConfig.httpHeaders")?.let(::parseApiStringMap)
    val message = value("${variant}Config.prepareMessageCallback")?.let { strategy -> PrepareMessageCallback { drmStrategy(it, strategy) } }
    val response = value("${variant}Config.prepareLicenseCallback")?.let { strategy -> PrepareLicenseCallback { drmStrategy(it, strategy) } }
    val keepalive = value("DrmConfig.drmSessionKeepaliveMs")
    require(keepalive == null || variant == "Widevine") { "The public keepalive constructor is available for Widevine; remove the override for another DRM variant." }
    val next = when (variant) {
        "PlayReady" -> PlayReadyConfig(url, message, response, headers)
        "NagraConnect" -> NagraConnectConfig(url.orEmpty(), value("NagraConnectConfig.operatorVault").orEmpty(), message, response, headers)
        "ClearKey" -> {
            require(value("DrmConfig.licenseUrl") == null) { "ClearKey entries do not use a license URL." }
            val key = value("ClearKeyConfigEntry.key") ?: error("Enter the ClearKey key together with its optional key ID.")
            ClearKeyConfig(key, value("ClearKeyConfigEntry.kid")?.ifBlank { null })
        }
        else -> WidevineConfig(
            licenseUrl = url,
            httpHeaders = headers?.let { entries -> buildMap<String?, String?> { entries.forEach { put(it.key, it.value) } } },
            preferredSecurityLevel = value("WidevineConfig.preferredSecurityLevel")?.takeUnless { it == "null" },
            prepareMessageCallback = message,
            prepareLicenseCallback = response,
            drmSessionKeepaliveMs = keepalive?.takeUnless { it == "null" }?.toLong(),
        )
    }
    value("DrmConfig.httpHeaders")?.let {
        next.httpHeaders = mutableMapOf<String?, String?>().also { target -> parseApiStringMap(it).forEach { (name, v) -> target[name] = v } }
    }
    value("DrmConfig.isLicenseRenewable")?.let { next.isLicenseRenewable = it.toBooleanStrict() }
    value("DrmConfig.shouldKeepDrmSessionsAlive")?.let { next.shouldKeepDrmSessionsAlive = it.toBooleanStrict() }
    value("DrmConfig.immediateLicenseRequest")?.let { next.immediateLicenseRequest = it.toBooleanStrict() }
    source.drmConfig = next
}

/** Redact license URLs, headers, keys and operator vaults from code export. */
internal fun apiDrmCode(values: Map<String, String>): String {
    if (values.isEmpty()) return ""
    fun value(name: String) = values[DRM + name]
    val variant = drmVariant(values)
    if (variant == "None") return "\nsourceConfig.drmConfig = null"
    val lines = mutableListOf("", "// DRM secrets are placeholders. Import com.bitmovin.player.api.drm.*.")
    fun callback(name: String): String {
        val strategy = value("${variant}Config.$name") ?: return "null"
        val type = if (name == "prepareMessageCallback") "PrepareMessageCallback" else "PrepareLicenseCallback"
        val expression = when (strategy) {
            "Identity" -> "bytes"
            "Base64Encode" -> "android.util.Base64.encode(bytes, android.util.Base64.NO_WRAP)"
            else -> "android.util.Base64.decode(bytes, android.util.Base64.DEFAULT)"
        }
        return "$type { bytes -> $expression }"
    }
    if (variant == "ClearKey") {
        val keyIdCode = if (value("ClearKeyConfigEntry.kid").isNullOrBlank()) "null" else kotlinString("YOUR_KEY_ID")
        lines += "sourceConfig.drmConfig = ClearKeyConfig(\"YOUR_CLEAR_KEY\", $keyIdCode)"
    } else {
        val arguments = mutableListOf("licenseUrl = ${if (value("DrmConfig.licenseUrl") != null) "\"YOUR_LICENSE_URL\"" else "null"}")
        if (variant == "NagraConnect") arguments += "operatorVault = \"YOUR_OPERATOR_VAULT\""
        arguments += "prepareMessageCallback = ${callback("prepareMessageCallback")}"
        arguments += "prepareLicenseCallback = ${callback("prepareLicenseCallback")}"
        if (variant == "Widevine") {
            value("WidevineConfig.preferredSecurityLevel")?.let { arguments += "preferredSecurityLevel = ${if (it == "null") it else kotlinString(it)}" }
            value("DrmConfig.drmSessionKeepaliveMs")?.let { arguments += "drmSessionKeepaliveMs = ${if (it == "null") it else "${it}L"}" }
        }
        lines += "sourceConfig.drmConfig = ${variant}Config(${arguments.joinToString(", ")})"
    }
    value("DrmConfig.httpHeaders")?.let { lines += "requireNotNull(sourceConfig.drmConfig).httpHeaders = mutableMapOf(\"YOUR_HEADER\" to \"YOUR_HEADER_VALUE\")" }
    for (name in listOf("isLicenseRenewable", "shouldKeepDrmSessionsAlive", "immediateLicenseRequest")) {
        value("DrmConfig.$name")?.let { lines += "requireNotNull(sourceConfig.drmConfig).$name = $it" }
    }
    return lines.joinToString("\n")
}
