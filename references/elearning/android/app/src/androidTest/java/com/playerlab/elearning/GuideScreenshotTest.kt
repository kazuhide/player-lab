package com.playerlab.elearning

import android.content.Intent
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.event.PlayerEvent
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@SdkSuppress(minSdkVersion = 26)
class GuideScreenshotTest {
    @Test fun captureRealLocalizedCourseAndPlaybackContent() {
        val args = InstrumentationRegistry.getArguments()
        val language = args.getString("guideLocale") ?: "en"
        require(language in listOf("en", "ja"))
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
        args.getString("mediaBaseUrl")?.let { intent.putExtra("mediaBaseUrl", it) }
        GuideLocaleOverride.setForTest(language)
        try {
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            var intendedCue = false
            val phrase = if (language == "ja") "数字を読みます。" else "Read the numbers."
            val entered: (PlayerEvent.CueEnter) -> Unit = { if (it.cue.styledText?.contains(phrase) == true) intendedCue = true }
            await(scenario) { it.catalog != null && !it.progressLoading }
            capture(scenario, "course-$language.png")
            scenario.onActivity { it.sessionForTest().apply { player.on(PlayerEvent.CueEnter::class, entered); startLesson("EDU-FX-01", play = false) } }
            await(scenario) { it.player.duration > 0 && !it.transcriptLoading && it.player.source?.availableSubtitleTracks?.size == 2 && it.playbackReady }
            scenario.onActivity { it.sessionForTest().apply {
                setSubtitle(SubtitlePreference(true, language))
                viewState.transcriptLanguage = language
                seek(10_500)
                player.play()
            } }
            await(scenario) { it.positionMs > 11_000 && intendedCue && it.activeCueCount > 0 }
            scenario.onActivity { it.sessionForTest().player.pause() }
            await(scenario) { !it.player.isPlaying && it.activeCueCount > 0 }
            scenario.onActivity { it.setUiMode(UiMode.DEFAULT) }
            awaitSdkHtmlControls(scenario)
            capture(scenario, "standard-ui-$language.png")
            scenario.onActivity { it.setUiMode(UiMode.LEARNING) }
            capture(scenario, "learning-ui-$language.png")
            scenario.onActivity { it.sessionForTest().player.off(PlayerEvent.CueEnter::class, entered) }
        }
        } finally { GuideLocaleOverride.setForTest(null) }
    }

    private fun await(scenario: ActivityScenario<MainActivity>, predicate: (PlaybackSession) -> Boolean) {
        val deadline = System.nanoTime() + 35_000_000_000L
        do {
            var ready = false
            scenario.onActivity { assertNull(it.sessionForTest().errorCode); ready = predicate(it.sessionForTest()) }
            if (ready) return
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        fail("Live app state required for guide capture did not arrive")
    }

    private fun capture(scenario: ActivityScenario<MainActivity>, name: String) {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        val finished = CountDownLatch(1)
        val result = AtomicInteger(-1)
        var bitmap: Bitmap? = null
        var output: File? = null
        scenario.onActivity { activity ->
            val bounds = activity.screenshotBoundsForTest()
            assertTrue(bounds.width() > 0 && bounds.height() > 0)
            bitmap = Bitmap.createBitmap(bounds.width(), bounds.height(), Bitmap.Config.ARGB_8888)
            output = File(activity.cacheDir, "guide-screenshots/$name").apply { parentFile!!.mkdirs() }
            PixelCopy.request(activity.window, bounds, requireNotNull(bitmap), { code -> result.set(code); finished.countDown() }, Handler(Looper.getMainLooper()))
        }
        assertTrue("PixelCopy timed out", finished.await(5, TimeUnit.SECONDS))
        assertEquals(PixelCopy.SUCCESS, result.get())
        requireNotNull(output).outputStream().use { assertTrue(requireNotNull(bitmap).compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap?.recycle()
    }
}
