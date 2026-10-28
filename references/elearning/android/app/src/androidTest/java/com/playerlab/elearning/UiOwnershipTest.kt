package com.playerlab.elearning

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class UiOwnershipTest {
    private fun launch(): ActivityScenario<MainActivity> {
        val args = InstrumentationRegistry.getArguments()
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra("spikeSourceUrl", args.getString("sourceUrl") ?: BuildConfig.MEDIA_BASE_URL + "EDU-FX-01/hls/master.m3u8")
            .putExtra("spikeSubtitleUrl", args.getString("subtitleUrl") ?: BuildConfig.MEDIA_BASE_URL + "subtitles/EDU-FX-01.en.vtt")
        return ActivityScenario.launch(intent)
    }

    private fun snapshot(scenario: ActivityScenario<MainActivity>): PlaybackSnapshot {
        var result: PlaybackSnapshot? = null
        scenario.onActivity { result = it.snapshot() }
        return requireNotNull(result)
    }

    private fun await(scenario: ActivityScenario<MainActivity>, message: String, predicate: (PlaybackSnapshot) -> Boolean) {
        val deadline = System.nanoTime() + 30_000_000_000L
        do {
            val value = snapshot(scenario)
            assertFalse("Playback error: ${value.errorCode}", value.errorCode != null)
            if (predicate(value)) return
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        fail(message)
    }

    @Test fun playingSwitchPreservesSourceClockAndImpression() = launch().use { scenario ->
        await(scenario, "Source did not become ready") { it.duration > 0 }
        scenario.onActivity { it.playForTest() }
        await(scenario, "Playback did not produce frames") { it.playing && it.time > 2 && it.frames > 2 }
        val before = snapshot(scenario)
        scenario.onActivity { it.setUiMode(UiMode.LEARNING) }
        await(scenario, "Clock did not advance after UI replacement") { it.time > before.time + 1 && it.frames > before.frames }
        val after = snapshot(scenario)
        assertEquals(before.playerIdentity, after.playerIdentity)
        assertEquals(before.sourceIdentity, after.sourceIdentity)
        assertEquals(before.loads, after.loads)
        assertEquals(before.seeks, after.seeks)
        assertEquals(before.impressionId, after.impressionId)
        assertEquals(1, after.playerViews)
        assertEquals(1, after.subtitleViews)
        assertFalse(after.destroyed)
        if (BuildConfig.ANALYTICS_LICENSE_KEY.isNotBlank()) assertFalse(before.impressionId.isNullOrBlank())
    }

    @Test fun pausedSwitchKeepsPositionSpeedAndSubtitle() = launch().use { scenario ->
        await(scenario, "Source did not become ready") { it.duration > 0 }
        scenario.onActivity { it.setUiMode(UiMode.LEARNING); it.preparePausedTestState() }
        val before = snapshot(scenario)
        scenario.onActivity { it.setUiMode(UiMode.DEFAULT) }
        Thread.sleep(600)
        val after = snapshot(scenario)
        assertEquals(before.playerIdentity, after.playerIdentity)
        assertEquals(before.sourceIdentity, after.sourceIdentity)
        assertEquals(before.time, after.time, 0.25)
        assertEquals(before.speed, after.speed, 0.0f)
        assertEquals(before.subtitleId, after.subtitleId)
        assertEquals(before.loads, after.loads)
        assertEquals(before.seeks, after.seeks)
        assertFalse(after.playing)
        assertEquals(0, after.subtitleViews)
    }

    @Test fun repeatedSwitchAndRotationLeaveOneOwner() = launch().use { scenario ->
        await(scenario, "Source did not become ready") { it.duration > 0 }
        val before = snapshot(scenario)
        repeat(5) { scenario.onActivity { it.setUiMode(UiMode.LEARNING); it.setUiMode(UiMode.DEFAULT) } }
        scenario.recreate()
        val after = snapshot(scenario)
        assertEquals(before.playerIdentity, after.playerIdentity)
        assertEquals(before.sourceIdentity, after.sourceIdentity)
        assertEquals(before.loads, after.loads)
        assertEquals(1, after.playerViews)
        assertEquals(0, after.subtitleViews)
        assertFalse(after.destroyed)
    }
}
