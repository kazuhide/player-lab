package com.playerlab.android

/** Example code stays separate from translatable app-owned prose. */
internal data class ApiHelpText(val paragraphs: List<String>, val example: String? = null)

internal fun apiHelpText(help: String): ApiHelpText {
    if (!help.startsWith(ApiScriptSettings.GUIDE)) return ApiHelpText(listOf(help))
    val body = help.removePrefix(ApiScriptSettings.GUIDE)
    return ApiHelpText(listOf(ApiScriptSettings.GUIDE, body.substringBefore(ApiScriptSettings.EXAMPLE_SEPARATOR)),
        body.substringAfter(ApiScriptSettings.EXAMPLE_SEPARATOR, "").takeIf { it.isNotEmpty() })
}
