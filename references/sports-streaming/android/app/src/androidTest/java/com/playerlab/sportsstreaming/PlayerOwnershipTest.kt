package com.playerlab.sportsstreaming

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import com.bitmovin.player.api.event.PlayerEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayerOwnershipTest {
    @Test fun uiSwitchKeepsPlayerSourceImpressionAndPausedPosition() = withPlayer { scenario ->
        prepareNonDefaultSettings(scenario)
        lateinit var before: OwnershipSnapshot
        scenario.onActivity { activity ->
            activity.playbackForTest().player.pause()
            before = activity.playbackForTest().snapshot()
            assertNotNull("Analytics must be configured for impression continuity", before.impressionId)
        }
        repeat(20) { index -> scenario.onActivity { it.switchUiForTest(index % 2 == 0) } }
        scenario.onActivity { activity ->
            val after = activity.playbackForTest().snapshot()
            assertIdentity(before, after)
            assertTrue(after.paused)
            assertEquals(before.positionSeconds, after.positionSeconds, 1.0)
            assertEquals(1, activity.attachedPlayerViewCountForTest())
        }
    }

    @Test fun uiSwitchKeepsPlayingAndClockAdvancing() = withPlayer { scenario ->
        prepareNonDefaultSettings(scenario)
        lateinit var before: OwnershipSnapshot
        scenario.onActivity { before = it.playbackForTest().snapshot() }
        repeat(20) { index ->
            scenario.onActivity {
                it.switchUiForTest(index % 2 == 0)
                assertTrue("UI switch must retain playing intent", it.playbackForTest().player.isPlaying)
            }
            Thread.sleep(100)
        }
        scenario.onActivity { activity ->
            val after = activity.playbackForTest().snapshot()
            assertIdentity(before, after)
            assertFalse(after.paused)
            assertTrue("Playback clock must advance", after.positionSeconds > before.positionSeconds + 0.3)
            assertEquals(1, activity.attachedPlayerViewCountForTest())
        }
    }

    @Test fun pausedNativeCueRemainsRenderedAcrossUiChanges(): Unit = withPlayer { scenario ->
        requireNotNull(InstrumentationRegistry.getArguments().getString("subtitleUrl")) {
            "An actual caption fixture is required for the rendered-cue check"
        }
        scenario.onActivity { it.switchUiForTest(true) }
        waitUntil(scenario) { it.nativeSubtitleViewForTest().width > 0 && it.nativeSubtitleViewForTest().height > 0 }
        scenario.onActivity { it.playbackForTest().player.source?.setSubtitleTrack("off") }
        waitUntil(scenario) { it.playbackForTest().snapshot().subtitleId in setOf(null, "off") }
        Thread.sleep(100)
        var empty: Bitmap? = null
        var expectedCue: String? = null
        val listener: (PlayerEvent.CueEnter) -> Unit = { expectedCue = it.cue.styledText?.toString() }
        scenario.onActivity {
            empty = renderSubtitle(it)
            it.playbackForTest().player.on(PlayerEvent.CueEnter::class, listener)
        }
        try {
            prepareNonDefaultSettings(scenario)
            waitUntil(scenario) { !expectedCue.isNullOrBlank() }
            scenario.onActivity { it.playbackForTest().player.pause() }
            var rendered: Bitmap? = null
            var nativeView: View? = null
            scenario.onActivity {
                nativeView = it.nativeSubtitleViewForTest()
                rendered = renderSubtitle(it)
                assertFalse("The selected cue must produce actual rendered glyph pixels", rendered!!.sameAs(empty!!))
            }
            repeat(20) { index -> scenario.onActivity { it.switchUiForTest(index % 2 == 1) } }
            scenario.onActivity {
                assertSame(nativeView, it.nativeSubtitleViewForTest())
                assertEquals(View.VISIBLE, it.nativeSubtitleViewForTest().visibility)
                assertTrue(it.playbackForTest().player.isPaused)
                val after = renderSubtitle(it)
                assertTrue("Paused cue glyph pixels must survive UI switches", rendered!!.sameAs(after))
                after.recycle()
            }
            rendered?.recycle()
        } finally {
            empty?.recycle()
            scenario.onActivity { it.playbackForTest().player.off(PlayerEvent.CueEnter::class, listener) }
        }
    }
    private fun renderSubtitle(activity: MainActivity): Bitmap {
        val view = activity.nativeSubtitleViewForTest()
        return Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
    }

    private fun prepareNonDefaultSettings(scenario: ActivityScenario<MainActivity>) {
        scenario.onActivity { it.playbackForTest().player.playbackSpeed = 1.25f }
        if (InstrumentationRegistry.getArguments().getString("subtitleUrl") != null) {
            waitUntil(scenario) { it.playbackForTest().player.source?.availableSubtitleTracks?.any { track -> track.id == "test-en" } == true }
            scenario.onActivity { it.playbackForTest().player.source?.setSubtitleTrack("test-en") }
            waitUntil(scenario) { it.playbackForTest().snapshot().subtitleId == "test-en" }
        }
    }
    private fun assertIdentity(before: OwnershipSnapshot, after: OwnershipSnapshot) {
        assertSame(before.player, after.player)
        assertSame(before.source, after.source)
        assertEquals(before.impressionId, after.impressionId)
        assertEquals(before.loadCount, after.loadCount)
        assertEquals(before.speed, after.speed)
        assertEquals(before.subtitleId, after.subtitleId)
    }
    private fun withPlayer(test: (ActivityScenario<MainActivity>) -> Unit) {
        val arguments = InstrumentationRegistry.getArguments()
        val url = requireNotNull(arguments.getString("sourceUrl")) { "Pass a reachable HLS or DASH sourceUrl" }
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra("testSourceUrl", url).putExtra("testSubtitleUrl", arguments.getString("subtitleUrl"))
            .putExtra("mediaBaseUrl", arguments.getString("mediaBaseUrl"))
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            waitUntil(scenario) { it.playbackForTest().player.isPlaying }
            test(scenario)
        }
    }
    private fun waitUntil(scenario: ActivityScenario<MainActivity>, predicate: (MainActivity) -> Boolean) {
        val deadline = System.nanoTime() + 45_000_000_000L
        while (System.nanoTime() < deadline) {
            var satisfied = false
            scenario.onActivity {
                val error = it.playbackForTest().lastErrorCode
                assertNull("SDK reported error code $error", error)
                satisfied = predicate(it)
            }
            if (satisfied) return
            Thread.sleep(100)
        }
        fail("Playback did not reach the expected state within 45 seconds")
    }
}
