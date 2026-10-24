package com.playerlab.android

import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject

/** Captures only the visible sample UI to the app-private test cache. */
internal object ApiGuideScreenshot {
    fun capture(name: String, activity: MainActivity? = null) {
        require(name.matches(Regex("[a-z0-9-]+")))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        InstrumentationRegistry.getArguments().getString("guideLocale")?.let { language ->
            captureLocalized(name, language, requireNotNull(activity))
            return
        }
        instrumentation.waitForIdleSync()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            val locale = instrumentation.targetContext.resources.configuration.locales[0].language
            val directory = File(instrumentation.targetContext.cacheDir, "guide-captures/$locale").apply { mkdirs() }
            File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        } finally { bitmap.recycle() }
    }

    /** Locale and run directories prevent one language or run from replacing another capture. */
    fun captureLocalized(name: String, expectedLanguage: String, activity: MainActivity) {
        require(name.matches(Regex("[a-z0-9-]+")))
        require(expectedLanguage in setOf("en", "ja"))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val arguments = InstrumentationRegistry.getArguments()
        val run = requireNotNull(arguments.getString("guideCaptureRun"))
        require(run.matches(Regex("[a-z0-9-]{1,80}")))
        val actual = activity.resources.configuration.locales[0]
        check(actual.language == expectedLanguage) { "Capture locale does not match the actual activity locale." }
        instrumentation.waitForIdleSync()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            val directory = File(activity.cacheDir, "guide-captures/$run/$expectedLanguage").apply { mkdirs() }
            val file = File(directory, "$name-$expectedLanguage.png")
            check(!file.exists()) { "A guide capture cannot overwrite an existing image." }
            file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
            val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
            File(directory, "$name-$expectedLanguage.json").writeText(JSONObject().apply {
                put("name", name); put("language", expectedLanguage); put("activityLocale", actual.toLanguageTag())
                put("width", bitmap.width); put("height", bitmap.height); put("sha256", digest)
                put("package", activity.packageName)
                put("sourceRevision", arguments.getString("guideSourceRevision", "working-tree"))
                val mode = activity.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK
                put("deviceSurface", if (mode == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION) "android-tv" else "phone")
                put("configurationUiModeType", mode)
                put("workingTreeSourceSha256", arguments.getString("guideWorkingTreeSourceSha256", "unspecified"))
            }.toString(2) + "\n")
        } finally { bitmap.recycle() }
    }
}
