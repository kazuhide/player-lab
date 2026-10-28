package com.playerlab.sportsstreaming

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.playerlab.sportsstreaming.core.StreamProtocol
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SourceLifecycleTest {
    @Test fun rotationAndPictureInPicturePreserveTheActualSourceAndPlayingIntent() {
        val args = InstrumentationRegistry.getArguments()
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra("mediaBaseUrl", requireNotNull(args.getString("mediaBaseUrl")))
        val protocol = StreamProtocol.valueOf(args.getString("protocol", "HLS").uppercase())
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            try {
                waitUntil(scenario) { !it.playbackForTest().state.value.loadingCatalog && it.playbackForTest().state.value.catalog != null }
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
                waitUntil(scenario) { it.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT }
                scenario.onActivity { it.playbackForTest().selectAsset("SP-CLIP-B", protocol); it.switchUiForTest(true) }
                waitUntil(scenario) { it.playbackForTest().state.value.canControlPlayback && it.playbackForTest().player.isPlaying }
                lateinit var initial: OwnershipSnapshot
                scenario.onActivity { initial = it.playbackForTest().snapshot(); assertNotNull(initial.impressionId) }
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                waitUntil(scenario) { it.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
                waitUntil(scenario, 10_000) { it.playbackForTest().player.isPlaying }
                Thread.sleep(1_000)
                scenario.onActivity {
                    assertOwnership(initial, it)
                    assertTrue("Playing clock must advance across actual rotation", it.playbackForTest().player.currentTime > initial.positionSeconds + 0.5)
                    it.playbackForTest().player.pause()
                }
                waitUntil(scenario) { it.playbackForTest().player.isPaused && !it.playbackForTest().player.isPlaying }
                var pausedAt = 0.0
                scenario.onActivity { pausedAt = it.playbackForTest().player.currentTime; it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
                waitUntil(scenario) { it.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT }
                scenario.onActivity {
                    assertOwnership(initial, it)
                    assertTrue("Paused intent must survive actual rotation", it.playbackForTest().player.isPaused && !it.playbackForTest().player.isPlaying)
                    assertEquals(pausedAt, it.playbackForTest().player.currentTime, 1.0)
                    it.playbackForTest().seekTo(3_000)
                }
                waitUntil(scenario) { kotlin.math.abs(it.playbackForTest().player.currentTime - 3.0) < 0.6 }
                scenario.onActivity { it.playbackForTest().player.play() }
                waitUntil(scenario) { it.playbackForTest().player.isPlaying }
                var pipLabel = ""
                scenario.onActivity { pipLabel = it.getString(R.string.pip) }
                val pip = device.wait(Until.findObject(By.desc(pipLabel)), 10_000)
                assertNotNull("The visible PiP action must be available", pip)
                pip.click()
                waitUntil(scenario, 10_000) { it.isInPictureInPictureMode }
                var beforePip = 0.0
                scenario.onActivity { beforePip = it.playbackForTest().player.currentTime }
                Thread.sleep(1_500)
                scenario.onActivity {
                    assertOwnership(initial, it)
                    assertTrue("PiP must keep actual playback running", it.playbackForTest().player.isPlaying)
                    assertTrue("The PiP playback clock must advance", it.playbackForTest().player.currentTime > beforePip + 0.5)
                }
                val restore = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                InstrumentationRegistry.getInstrumentation().targetContext.startActivity(restore)
                waitUntil(scenario, 10_000) { !it.isInPictureInPictureMode }
                scenario.onActivity { assertOwnership(initial, it); assertTrue(it.playbackForTest().player.isPlaying) }
            } finally {
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED; it.playbackForTest().player.pause() }
            }
        }
    }
    private fun assertOwnership(expected: OwnershipSnapshot, activity: MainActivity) {
        val actual = activity.playbackForTest().snapshot()
        assertSame(expected.player, actual.player)
        assertSame(expected.source, actual.source)
        assertEquals(expected.impressionId, actual.impressionId)
        assertEquals(expected.loadCount, actual.loadCount)
        assertEquals(1, activity.attachedPlayerViewCountForTest())
    }
    private fun waitUntil(scenario: ActivityScenario<MainActivity>, timeoutMs: Long = 30_000, condition: (MainActivity) -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            var ready = false
            scenario.onActivity { assertNull(it.playbackForTest().lastErrorCode); ready = condition(it) }
            if (ready) return
            Thread.sleep(100)
        }
        fail("Required lifecycle or playback state was not observed")
    }
}
