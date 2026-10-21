package com.playerlab.android

import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

/** Captures only the visible sample UI to the app-private test cache. */
internal object ApiGuideScreenshot {
    fun capture(name: String) {
        require(name.matches(Regex("[a-z0-9-]+")))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            val directory = File(instrumentation.targetContext.cacheDir, "guide-captures").apply { mkdirs() }
            File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        } finally { bitmap.recycle() }
    }
}
