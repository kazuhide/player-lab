package com.playerlab.elearning

/** A debug-only initial context override for capturing actual localized resources in instrumentation. */
object GuideLocaleOverride {
    var language: String? = null
        private set
    var fontScale: Float? = null
        private set
    fun setForTest(language: String?) {
        check(BuildConfig.DEBUG)
        require(language == null || language in listOf("en", "ja"))
        this.language = language
    }
    fun setFontScaleForTest(value: Float?) {
        check(BuildConfig.DEBUG)
        require(value == null || value in 0.85f..2f)
        fontScale = value
    }
}
