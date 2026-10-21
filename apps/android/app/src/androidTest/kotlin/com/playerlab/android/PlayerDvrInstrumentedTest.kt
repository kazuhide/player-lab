package com.playerlab.android

import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.event.PlayerEvent
import com.playerlab.android.dvr.Dvr
import com.playerlab.android.dvr.DvrConfig
import com.playerlab.android.dvr.PlaybackMode
import com.playerlab.android.dvr.PlayerSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/**
 * On-device integration test — drives the REAL Bitmovin Player against a public VOD
 * and checks the DVR snapshot the app's UI consumes. The Android analog of the web
 * Playwright harness.
 *
 * Runs on an emulator/device: `./gradlew :app:connectedAndroidTest`. The player
 * passes the app's manifest license into PlayerConfig, so the build needs
 * `-PbitmovinLicenseKey=...` and `com.playerlab.android` allow-listed. The pure DVR math
 * is covered separately by the `:dvr` unit tests; this verifies the real player API.
 */
@RunWith(AndroidJUnit4::class)
class PlayerDvrInstrumentedTest {

    @Test
    fun vodReportsFiniteDurationAndDerivesVodState() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val ctx = instrumentation.targetContext
        val licenseKey = ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
            .metaData?.getString("BITMOVIN_PLAYER_LICENSE_KEY").orEmpty()
        assertTrue("Configure a native Player license before running playback tests", licenseKey.isNotBlank())
        lateinit var player: Player
        val completed = CountDownLatch(1)
        val loaded = AtomicBoolean(false)
        val errors = CopyOnWriteArrayList<Int>()

        // Player operations must run on the main thread.
        instrumentation.runOnMainSync {
            player = Player(ctx, PlayerConfig(key = licenseKey))
            player.on(SourceEvent.Loaded::class) { loaded.set(true); completed.countDown() }
            player.on(PlayerEvent.Error::class) {
                errors.add(it.code.value)
                completed.countDown()
            }
            player.on(SourceEvent.Error::class) {
                errors.add(it.code.value)
                completed.countDown()
            }
            player.load(Sources.all.first { !it.isLive }.toSourceConfig())
        }

        try {
            assertTrue("source did not finish within 30s", completed.await(30, TimeUnit.SECONDS))
            assertTrue("Player/Source error codes: $errors", errors.isEmpty())
            assertTrue("source did not load", loaded.get())

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
            }
        } finally {
            instrumentation.runOnMainSync { player.destroy() }
        }
    }
}
