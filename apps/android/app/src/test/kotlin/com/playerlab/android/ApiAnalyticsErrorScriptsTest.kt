package com.playerlab.android

import com.bitmovin.analytics.api.error.AnalyticsError
import com.bitmovin.analytics.api.error.ErrorContext
import com.bitmovin.analytics.api.error.ErrorSeverity
import org.junit.Assert.*
import org.junit.Test

class ApiAnalyticsErrorScriptsTest {
    @Test fun arbitraryBodyTransformsTypedErrorAndCanRetainItWithoutExposingSdkObjects() {
        val scope = ApiCallbackContext()
        val callback = ApiAnalyticsErrorScripts.callback("return {code: input.code + 2, message: input.originalErrorType + ': edited', severity: 'INFO'};", scope)
        val input = AnalyticsError(100, "Synthetic error", ErrorSeverity.CRITICAL)
        val result = callback.transform(input, ErrorContext(IllegalStateException("Never placed in the script snapshot")))!!
        assertEquals(102, result.code); assertEquals("IllegalStateException: edited", result.message); assertEquals(ErrorSeverity.INFO, result.severity)
        val drop = ApiAnalyticsErrorScripts.callback("return null;", scope)
        assertSame(input, drop.transform(input, ErrorContext(null)))
        assertEquals(2 to 0, scope.snapshot()["AnalyticsConfig.errorTransformerCallback"])
        scope.close()
        assertSame(input, callback.transform(input, ErrorContext(null)))
    }
    @Test fun invalidWholeResultRetainsOriginalErrorAndCodeExportDoesNotRevealBody() {
        val scope = ApiCallbackContext(); val input = AnalyticsError(1, "Synthetic", ErrorSeverity.INFO)
        val callback = ApiAnalyticsErrorScripts.callback("return {code: 2, message: 'changed', severity: 'invented'};", scope)
        assertSame(input, callback.transform(input, ErrorContext(null)))
        assertEquals(1 to 1, scope.snapshot()["AnalyticsConfig.errorTransformerCallback"])
        val settings = ApiAnalyticsSettings(errorStrategy = "Custom", errorCallbackBody = "return {message: 'local-only-marker'};")
        settings.playerConfig("unit-test-key")
        assertTrue(settings.code().contains("<YOUR_CALLBACK_BODY>")); assertFalse(settings.code().contains("local-only-marker"))
    }
}
