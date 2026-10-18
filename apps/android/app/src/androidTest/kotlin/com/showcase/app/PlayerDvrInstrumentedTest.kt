package com.showcase.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.event.SourceEvent
import com.showcase.dvr.Dvr
import com.showcase.dvr.DvrConfig
import com.showcase.dvr.PlaybackMode
import com.showcase.dvr.PlayerSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * On-device integration test — drives the REAL Bitmovin Player against a public VOD
 * and checks the DVR snapshot the app's UI consumes. The Android analog of the web
 * Playwright harness.
 *
 * Runs on an emulator/device: `./gradlew :app:connectedAndroidTest`. The player
 * reads its license from the manifest meta-data, so the build needs
 * `-PbitmovinLicenseKey=...` and `com.showcase.dvr` allow-listed. The pure DVR math
 * is covered separately by the `:dvr` unit tests; this verifies the real player API.
 */
@RunWith(AndroidJUnit4::class)
class PlayerDvrInstrumentedTest {

    @Test
    fun vodReportsFiniteDurationAndDerivesVodState() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val ctx = instrumentation.targetContext
        lateinit var player: Player
        val loaded = CountDownLatch(1)

        // Player operations must run on the main thread.
        instrumentation.runOnMainSync {
            player = Player(ctx, PlayerConfig())
            player.on(SourceEvent.Loaded::class) { loaded.countDown() }
            player.load(Sources.all.first { !it.isLive }.toSourceConfig())
        }

        assertTrue("source did not load within 30s", loaded.await(30, TimeUnit.SECONDS))

        instrumentation.runOnMainSync {
            assertFalse("VOD must not report isLive", player.isLive)
            assertTrue("VOD duration must be finite and positive", player.duration > 0 && player.duration.isFinite())

            val state = Dvr.deriveState(
                PlayerSnapshot(
                    isLive = player.isLive,
                    duration = player.duration,
                    maxTimeShift = player.maxTimeShift,
                    timeShift = player.timeShift,
                    currentTime = player.currentTime,
                ),
                DvrConfig(timeShiftEnabled = true),
            )
            assertEquals(PlaybackMode.VOD, state.mode)
            player.destroy()
        }
    }
}
