package com.playerlab.android

import com.bitmovin.analytics.api.error.AnalyticsError
import com.bitmovin.analytics.api.error.ErrorSeverity
import com.bitmovin.analytics.api.error.ErrorTransformerCallback

internal object ApiAnalyticsErrorScripts {
    fun callback(body: String, context: ApiCallbackContext): ErrorTransformerCallback {
        val program = ApiScriptProgram(body)
        return ErrorTransformerCallback { error, original ->
            context.apply("AnalyticsConfig.errorTransformerCallback", program,
                mapOf("code" to error.code, "message" to error.message, "severity" to error.severity.name,
                    "originalErrorType" to original.originalError?.javaClass?.simpleName), error) { value ->
                if (value == null) error else {
                    val fields = value as? Map<*, *> ?: error("Return an error value object or null.")
                    require(fields.keys.all { it in setOf("code", "message", "severity") })
                    val code = fields["code"]?.let { raw -> (raw as? Number)?.toDouble()?.also { require(it.isFinite() && it % 1.0 == 0.0 && it in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()) }?.toInt() ?: error("Error code must be a 32-bit integer.") } ?: error.code
                    val message = if ("message" in fields) (fields["message"] as? String ?: error("Error message must be a string.")).also { require(it.length <= 8192) } else error.message
                    val severity = fields["severity"]?.let { ErrorSeverity.valueOf(it as? String ?: error("Use a documented severity.")) } ?: error.severity
                    AnalyticsError(code, message, severity)
                }
            }
        }
    }
}
