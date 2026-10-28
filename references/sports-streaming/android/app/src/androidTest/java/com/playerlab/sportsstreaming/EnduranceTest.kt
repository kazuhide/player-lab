package com.playerlab.sportsstreaming

import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.playerlab.sportsstreaming.core.ArchivePosition
import com.playerlab.sportsstreaming.core.ArchiveStatus
import com.playerlab.sportsstreaming.core.AssetKind
import com.playerlab.sportsstreaming.core.EventStatus
import com.playerlab.sportsstreaming.core.EventStatusParser
import com.playerlab.sportsstreaming.core.EventStatusUpdate
import com.playerlab.sportsstreaming.core.PlaybackRequest
import com.playerlab.sportsstreaming.core.StreamProtocol
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToLong

/** Explicit, local playback only. Its minimum qualification requires 1,800 real seconds. */
@RunWith(AndroidJUnit4::class)
class EnduranceTest {
    @Test fun normalEventSurvivesDvrExpiryAndContinuesIntoArchive() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val arguments = InstrumentationRegistry.getArguments()
        val base = requireNotNull(arguments.getString("mediaBaseUrl"))
        val liveId = requireNotNull(arguments.getString("expectedLiveAssetId"))
        val protocol = StreamProtocol.valueOf(arguments.getString("protocol", "HLS").uppercase())
        val targetSeconds = arguments.getString("targetDurationSeconds", "1800").toLong()
        require(targetSeconds in 1_800L..7_200L) { "Endurance qualification requires at least 1,800 real seconds" }
        val targetMs = targetSeconds * 1_000L
        val recorder = Recorder(protocol, liveId, targetMs)
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra("mediaBaseUrl", base)
        try {
            ActivityScenario.launch<MainActivity>(intent).use { scenario ->
                var changedKeepScreenOn = false
                try {
                    waitUntil(scenario, recorder) { !it.state.value.loadingCatalog && it.state.value.catalog != null }
                    lateinit var eventId: String
                    lateinit var archiveId: String
                    lateinit var statusUrl: String
                    var durationMs = 0L
                    scenario.onActivity { activity ->
                        val session = activity.playbackForTest()
                        assertFalse("Endurance must not operate an existing receiver", session.player.isCasting)
                        val catalog = requireNotNull(session.state.value.catalog)
                        val live = requireNotNull(catalog.asset(liveId))
                        assertEquals(AssetKind.LIVE, live.kind)
                        val event = requireNotNull(catalog.event(live.eventId))
                        assertEquals("Start a fresh normal event", EventStatus.LIVE, event.status)
                        eventId = event.id
                        archiveId = requireNotNull(event.archiveAssetId)
                        statusUrl = requireNotNull(event.statusUrl)
                        durationMs = requireNotNull(catalog.asset(archiveId)?.durationMs)
                        assertTrue("A short fixture cannot qualify a normal-event run", durationMs >= 1_800_000L)
                        changedKeepScreenOn = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON == 0
                        if (changedKeepScreenOn) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        activity.switchUiForTest(true)
                    }
                    loadAndWait(scenario, recorder, liveId) { it.selectAsset(liveId, protocol) }
                    val repository = CatalogRepository(instrumentation.targetContext)
                    fun status(): EventStatusUpdate {
                        val text = runBlocking { repository.status(statusUrl) }
                        val document = JSONObject(text)
                        recorder.observePublisherClock(document.getLong("mediaUtcNow"))
                        return EventStatusParser.parse(text, eventId, liveId, archiveId)
                    }
                    waitUntil(scenario, recorder) { it.player.isPlaying && it.player.isLive && it.state.value.viewedUtcMs != null }
                    val initial = status()
                    val origin = requireNotNull(initial.liveUtcStartMs)
                    assertTrue("Start within the normal event's first minute", requireNotNull(initial.seekableUtcEndMs) - origin <= 60_000L)
                    recorder.measurementStarted = SystemClock.elapsedRealtime()
                    recorder.phase = "live"
                    assertActualFramesAdvance(scenario, recorder)

                    waitUntil(scenario, recorder, 90_000) { it.player.maxTimeShift <= -20.0 }
                    shiftLiveAndWait(scenario, recorder, toLive = false)
                    var pausedTime = 0.0
                    pauseAndWait(scenario, recorder)
                    scenario.onActivity { pausedTime = it.playbackForTest().player.currentTime }
                    Thread.sleep(1_000)
                    scenario.onActivity {
                        assertEquals("A pause must retain playback position", pausedTime, it.playbackForTest().player.currentTime, 1.0)
                        it.playbackForTest().player.play()
                    }
                    waitUntil(scenario, recorder) { it.player.isPlaying }
                    recorder.pauseResumeVerified = true

                    var storedUtc = 0L
                    lateinit var pausedSource: Source
                    var pausedImpression: String? = null
                    pauseAndWait(scenario, recorder)
                    scenario.onActivity {
                        val session = it.playbackForTest()
                        storedUtc = actualViewedUtcMs(session)
                        pausedSource = requireNotNull(session.player.source)
                        pausedImpression = session.snapshot().impressionId
                        assertNotNull("Analytics is required for actual impression continuity", pausedImpression)
                    }
                    recorder.phase = "live-paused-until-expiry"
                    waitUntil(scenario, recorder) { it.state.value.activeAssetId == liveId && it.player.isPaused && !it.state.value.loadingSource }
                    val expiryDeadline = SystemClock.elapsedRealtime() + 300_000L
                    var expired = false
                    while (!expired && SystemClock.elapsedRealtime() < expiryDeadline) {
                        val observed = status()
                        expired = observed.seekableUtcStartMs?.let { it > storedUtc } == true
                        scenario.onActivity {
                            val session = it.playbackForTest()
                            assertTrue("The live session must stay paused while the publisher advances", session.player.isPaused && !session.player.isPlaying)
                            assertSame(pausedSource, session.player.source)
                            assertEquals(pausedImpression, session.snapshot().impressionId)
                        }
                        recorder.sample(scenario)
                        if (!expired) Thread.sleep(1_000)
                    }
                    assertTrue("The stored position must actually leave the publisher's retained window", expired)
                    scenario.onActivity {
                        val session = it.playbackForTest()
                        val earliest = session.player.maxTimeShift
                        val current = session.player.timeShift
                        assertTrue("Read finite current SDK live bounds before recovery", earliest.isFinite() && earliest < 0 && current.isFinite())
                        assertTrue(session.state.value.canControlPlayback)
                    }
                    shiftLiveAndWait(scenario, recorder, toLive = true)
                    scenario.onActivity {
                        val session = it.playbackForTest()
                        assertTrue("Seeking to live must not silently change pause intent", session.player.isPaused && !session.player.isPlaying)
                        session.player.play()
                    }
                    waitUntil(scenario, recorder) { it.player.isPlaying && it.player.timeShift > -3.0 }
                    scenario.onActivity {
                        assertSame(pausedSource, it.playbackForTest().player.source)
                        assertEquals(pausedImpression, it.playbackForTest().snapshot().impressionId)
                    }
                    recorder.expiredWindowRecoveryVerified = true
                    recorder.phase = "live"
                    assertActualFramesAdvance(scenario, recorder)

                    var heldSource: Source? = null
                    var heldImpression: String? = null
                    var heldUtcMs = 0L
                    var heldRawSeconds = 0.0
                    var heldRelativeSeconds = 0.0
                    var heldUtcRelativeOriginSeconds = 0.0
                    var endHold = false
                    var endedProcessing = false
                    var archiveReady = false
                    val eventDeadline = recorder.startedElapsedMs + maxOf(targetMs, durationMs) + 300_000L
                    var nextStatus = 0L
                    while (!archiveReady && SystemClock.elapsedRealtime() < eventDeadline) {
                        val now = SystemClock.elapsedRealtime()
                        if (now >= nextStatus) {
                            val observed = status()
                            nextStatus = now + 2_000L
                            if (!endHold && observed.eventStatus == EventStatus.LIVE &&
                                (observed.seekableUtcEndMs ?: 0L) - origin >= durationMs - 12_000L) {
                                shiftLiveAndWait(scenario, recorder, toLive = false)
                                pauseAndWait(scenario, recorder)
                                scenario.onActivity {
                                    val session = it.playbackForTest()
                                    heldSource = session.player.source
                                    heldImpression = session.snapshot().impressionId
                                    heldRawSeconds = session.player.currentTime
                                    val absoluteOffset = session.player.playbackTimeOffsetToAbsoluteTime
                                    val relativeOffset = session.player.playbackTimeOffsetToRelativeTime
                                    val directSdkUtc = (heldRawSeconds + absoluteOffset) * 1_000.0
                                    assertTrue("The held reference must come directly from the live SDK timeline", directSdkUtc.isFinite() && directSdkUtc >= origin)
                                    heldUtcMs = directSdkUtc.roundToLong()
                                    heldRelativeSeconds = heldRawSeconds + relativeOffset
                                    heldUtcRelativeOriginSeconds = absoluteOffset - relativeOffset
                                    assertEquals(heldUtcMs.toDouble(), actualViewedUtcMs(session).toDouble(), 1.0)
                                    SdkClockSnapshot.capture(session, "endurance-before")
                                    assertNotNull("Analytics is required for actual impression continuity", heldImpression)
                                }
                                recorder.phase = "end-paused"
                                endHold = true
                            }
                            if (observed.eventStatus == EventStatus.ENDED) {
                                assertTrue("The final DVR position must be held before the event ends", endHold)
                                scenario.onActivity {
                                    val session = it.playbackForTest()
                                    SdkClockSnapshot.capture(session, "endurance-after")
                                    assertSame("Event end must not reload the Source", heldSource, session.player.source)
                                    assertEquals(heldImpression, session.snapshot().impressionId)
                                    assertTrue("Event end must preserve pause", session.player.isPaused && !session.player.isPlaying)
                                    val relativeNow = session.player.currentTime + session.player.playbackTimeOffsetToRelativeTime
                                    assertEquals("Finalization must preserve the independently held SDK-relative coordinate", heldRelativeSeconds, relativeNow, 1.0)
                                    if (protocol == StreamProtocol.HLS)
                                        assertEquals("The observed HLS raw coordinate must remain continuous", heldRawSeconds, session.player.currentTime, 1.0)
                                    assertEquals("Independent pre-end SDK offsets and fresh relative time must preserve UTC", heldUtcMs.toDouble(),
                                        (relativeNow + heldUtcRelativeOriginSeconds) * 1_000.0, 1_000.0)
                                    val currentUtcMs = actualViewedUtcMs(session)
                                    assertTrue("Event end must retain the viewed UTC position", abs(currentUtcMs - heldUtcMs) <= 1_000L)
                                }
                                if (observed.archiveStatus == ArchiveStatus.PROCESSING) endedProcessing = true
                                if (observed.archiveStatus == ArchiveStatus.READY) archiveReady = true
                            }
                        }
                        recorder.sample(scenario)
                        Thread.sleep(200)
                    }
                    assertTrue("Event end and archive processing must be observed separately", endedProcessing)
                    assertTrue("The archive must become ready through real elapsed time", archiveReady)
                    recorder.endedBeforeReadyVerified = true
                    waitUntil(scenario, recorder) { it.state.value.selectedEvent?.archiveStatus == ArchiveStatus.READY &&
                        it.state.value.archivePosition is ArchivePosition.Available }
                    var mappedPosition = 0L
                    scenario.onActivity {
                        mappedPosition = (it.playbackForTest().state.value.archivePosition as ArchivePosition.Available).positionMs
                    }
                    recorder.phase = "archive-paused"
                    loadAndWait(scenario, recorder, archiveId) { it.continueInArchive() }
                    waitUntil(scenario, recorder) {
                        it.state.value.activeAssetId == archiveId && !it.state.value.loadingSource && !it.desiredPlaying &&
                            !it.player.isPlaying && abs(it.player.currentTime * 1_000 - mappedPosition) <= 1_000
                    }
                    Thread.sleep(1_000)
                    scenario.onActivity {
                        assertFalse("A ready archive must retain the requested non-playing intent", it.playbackForTest().player.isPlaying)
                        assertFalse(it.playbackForTest().desiredPlaying)
                        assertEquals(mappedPosition.toDouble(), it.playbackForTest().player.currentTime * 1_000, 1_000.0)
                        SdkClockSnapshot.capture(it.playbackForTest(), "endurance-archive-ready")
                        assertNotSame(heldSource, it.playbackForTest().player.source)
                        val archiveImpression = it.playbackForTest().snapshot().impressionId
                        assertNotNull("Archive playback must have an actual impression", archiveImpression)
                        assertNotEquals("A new Source starts a separate impression", heldImpression, archiveImpression)
                        it.playbackForTest().player.play()
                    }
                    recorder.phase = "archive"
                    waitUntil(scenario, recorder) { it.player.isPlaying }
                    assertActualFramesAdvance(scenario, recorder)
                    recorder.archiveHandoffVerified = true
                    while (SystemClock.elapsedRealtime() - recorder.measurementStarted < targetMs) {
                        recorder.sample(scenario)
                        Thread.sleep(200)
                    }
                    assertTrue("Real measurement wall time must reach the requested duration", SystemClock.elapsedRealtime() - recorder.measurementStarted >= targetMs)
                    assertTrue("Actual decoded video must change throughout the run", recorder.frameChanges >= 12)
                    assertTrue("The live playback clock must advance in sampled real intervals", recorder.liveClockAdvancingMs >= 1_200_000L)
                    recorder.passed = true
                } finally {
                    recorder.sample(scenario, force = true)
                    scenario.onActivity {
                        it.playbackForTest().player.pause()
                        if (changedKeepScreenOn) it.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                }
            }
        } finally {
            recorder.writeReceipt()
        }
    }

    private fun shiftLiveAndWait(scenario: ActivityScenario<MainActivity>, recorder: Recorder, toLive: Boolean) {
        var finished = false
        var beforeUtcMs = 0L
        var expectedSource: Source? = null
        var expectedRequest: PlaybackRequest? = null
        lateinit var session: PlaybackSession
        val listener: (PlayerEvent.TimeShifted) -> Unit = {
            if (session.player.source === expectedSource && session.coordinator.current == expectedRequest) finished = true
        }
        scenario.onActivity {
            session = it.playbackForTest()
            expectedSource = session.player.source
            expectedRequest = session.coordinator.current
            beforeUtcMs = actualViewedUtcMs(session)
            assertTrue(session.state.value.canControlPlayback && session.player.isLive)
            assertTrue("Read fresh finite SDK seek bounds before dispatch", session.player.maxTimeShift.isFinite() && session.player.maxTimeShift < 0)
            session.player.on(PlayerEvent.TimeShifted::class, listener)
            if (toLive) session.goLive() else session.seekBy(-15.0)
        }
        try {
            waitUntil(scenario, recorder) {
                finished && it.player.source === expectedSource && it.coordinator.current == expectedRequest &&
                    (if (toLive) it.player.timeShift > -3.0 && actualViewedUtcMs(it) > beforeUtcMs + 10_000L
                    else it.player.timeShift <= -10.0 && actualViewedUtcMs(it) < beforeUtcMs - 10_000L)
            }
        } finally {
            scenario.onActivity { it.playbackForTest().player.off(PlayerEvent.TimeShifted::class, listener) }
        }
    }

    private fun pauseAndWait(scenario: ActivityScenario<MainActivity>, recorder: Recorder) {
        var finished = false
        lateinit var session: PlaybackSession
        var source: Source? = null
        var request: PlaybackRequest? = null
        val listener: (PlayerEvent.Paused) -> Unit = {
            if (session.player.source === source && session.coordinator.current == request) finished = true
        }
        scenario.onActivity {
            session = it.playbackForTest()
            source = session.player.source
            request = session.coordinator.current
            assertTrue("Pause must start from actual playback", session.player.isPlaying)
            session.player.on(PlayerEvent.Paused::class, listener)
            session.player.pause()
        }
        try {
            waitUntil(scenario, recorder) { finished && it.player.source === source && it.coordinator.current == request &&
                it.player.isPaused && !it.player.isPlaying }
        } finally {
            scenario.onActivity { it.playbackForTest().player.off(PlayerEvent.Paused::class, listener) }
        }
    }

    private fun loadAndWait(scenario: ActivityScenario<MainActivity>, recorder: Recorder, assetId: String,
                            operation: (PlaybackSession) -> Unit) {
        lateinit var session: PlaybackSession
        var source: Source? = null
        var request: PlaybackRequest? = null
        var loaded = false
        var ready = false
        val loadedListener: (SourceEvent.Loaded) -> Unit = {
            if (it.source === source && session.coordinator.current == request) loaded = true
        }
        val readyListener: (PlayerEvent.Ready) -> Unit = {
            if (source != null && session.player.source === source && session.coordinator.current == request) ready = true
        }
        scenario.onActivity {
            session = it.playbackForTest()
            val previous = session.player.source
            session.player.on(SourceEvent.Loaded::class, loadedListener)
            session.player.on(PlayerEvent.Ready::class, readyListener)
            operation(session)
            source = requireNotNull(session.player.source)
            request = requireNotNull(session.coordinator.current)
            assertNotSame("A new Source must own this load", previous, source)
        }
        try {
            waitUntil(scenario, recorder) { loaded && ready && it.player.source === source && source?.isActive == true &&
                it.coordinator.current == request && it.state.value.activeAssetId == assetId && !it.state.value.loadingSource }
        } finally {
            scenario.onActivity {
                it.playbackForTest().player.off(SourceEvent.Loaded::class, loadedListener)
                it.playbackForTest().player.off(PlayerEvent.Ready::class, readyListener)
            }
        }
    }

    private fun actualViewedUtcMs(session: PlaybackSession): Long {
        val origin = requireNotNull(session.state.value.activeAsset?.utcStartMs)
        val absolute = (session.player.currentTime + session.player.playbackTimeOffsetToAbsoluteTime) * 1_000.0
        val mapped = requireNotNull(session.viewedUtcForCurrentSource()) { "The current Source must have a verified UTC transform" }
        if (absolute.isFinite() && absolute >= origin)
            assertEquals("A valid direct SDK timestamp must match the fresh mapped timestamp", absolute, mapped.toDouble(), 1.0)
        return mapped
    }

    private fun waitUntil(scenario: ActivityScenario<MainActivity>, recorder: Recorder, timeoutMs: Long = 45_000L,
                          condition: (PlaybackSession) -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            var ready = false
            scenario.onActivity {
                assertNull("SDK reported error ${it.playbackForTest().lastErrorCode}", it.playbackForTest().lastErrorCode)
                ready = condition(it.playbackForTest())
            }
            if (ready) return
            recorder.sample(scenario)
            Thread.sleep(200)
        }
        fail("Required actual playback state was not observed during ${recorder.phase}")
    }

    private fun assertActualFramesAdvance(scenario: ActivityScenario<MainActivity>, recorder: Recorder) {
        val first = videoFingerprint(scenario)
        var changed = false
        val deadline = SystemClock.elapsedRealtime() + 10_000L
        while (!changed && SystemClock.elapsedRealtime() < deadline) {
            Thread.sleep(500)
            changed = videoFingerprint(scenario) != first
        }
        assertTrue("Actual video SurfaceView pixels must advance", changed)
        recorder.frameChanges++
    }

    private fun videoFingerprint(scenario: ActivityScenario<MainActivity>): String {
        fun surfaces(view: View): List<SurfaceView> = when (view) {
            is SurfaceView -> if (view.isShown && view.width > 0 && view.height > 0 && view.holder.surface.isValid) listOf(view) else emptyList()
            is ViewGroup -> (0 until view.childCount).flatMap { surfaces(view.getChildAt(it)) }
            else -> emptyList()
        }
        val bitmap = Bitmap.createBitmap(160, 90, Bitmap.Config.ARGB_8888)
        try {
            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (SystemClock.elapsedRealtime() < deadline) {
                val latch = CountDownLatch(1)
                var result = PixelCopy.ERROR_SOURCE_NO_DATA
                scenario.onActivity {
                    val visible = surfaces(it.window.decorView)
                    assertTrue("Multiple video surfaces must not own playback", visible.size <= 1)
                    if (visible.size == 1) PixelCopy.request(visible.single(), bitmap,
                        { code -> result = code; latch.countDown() }, Handler(Looper.getMainLooper()))
                    else latch.countDown()
                }
                assertTrue("Video pixel copy must complete", latch.await(5, TimeUnit.SECONDS))
                if (result == PixelCopy.SUCCESS) {
                    val pixels = IntArray(bitmap.width * bitmap.height)
                    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                    if (pixels.count { it and 0x00ffffff != 0 } > pixels.size / 100) {
                        val bytes = ByteBuffer.allocate(pixels.size * 4).apply { pixels.forEach(::putInt) }.array()
                        return MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
                    }
                }
                Thread.sleep(200)
            }
            throw AssertionError("An actual video surface with visible image pixels was not available")
        } finally { bitmap.recycle() }
    }

    private inner class Recorder(private val protocol: StreamProtocol, private val assetId: String, private val targetMs: Long) {
        val startedElapsedMs = SystemClock.elapsedRealtime()
        private val startedAtMs = System.currentTimeMillis()
        var measurementStarted = startedElapsedMs
        var phase = "setup"
        var passed = false
        var frameChanges = 0
        var liveClockAdvancingMs = 0L
        private var postEndlistClockAdvancingMs = 0L
        private var archiveClockAdvancingMs = 0L
        var pauseResumeVerified = false
        var expiredWindowRecoveryVerified = false
        var endedBeforeReadyVerified = false
        var archiveHandoffVerified = false
        private val observations = ArrayDeque<JSONObject>(200)
        private var observationCount = 0
        private var lastSampleMs = 0L
        private var lastFrameMs = 0L
        private var lastFrame: String? = null
        private var lastFrameChangeMs = startedElapsedMs
        private var previous: ClockSample? = null
        private var initialPublisherClock: Pair<Long, Long>? = null
        private var maximumPssKb = 0
        private var maximumHeapBytes = 0L
        private var maximumThermalStatus: Int? = null

        fun observePublisherClock(mediaUtcMs: Long) {
            val now = SystemClock.elapsedRealtime()
            val first = initialPublisherClock
            if (first == null) initialPublisherClock = mediaUtcMs to now
            else assertTrue("Publisher media time must not advance faster than real elapsed time", mediaUtcMs - first.first <= now - first.second + 4_000L)
        }

        fun sample(scenario: ActivityScenario<MainActivity>, force: Boolean = false) {
            val now = SystemClock.elapsedRealtime()
            if (!force && now - lastSampleMs < 1_000L) return
            lastSampleMs = now
            val item = JSONObject().put("elapsedMs", now - startedElapsedMs).put("phase", phase)
            var playing = false
            scenario.onActivity { activity ->
                val session = activity.playbackForTest()
                val state = session.state.value
                assertNull("SDK reported error ${session.lastErrorCode}", session.lastErrorCode)
                assertFalse("Local endurance must not start a Cast session", session.player.isCasting)
                assertTrue(session.diagnostics.entries.size <= 200 && session.handoffs.size <= 200)
                val current = ClockSample(now, state.activeAssetId, session.player.currentTime, session.player.isPlaying, session.player.isLive)
                val prior = previous
                if (prior != null && prior.assetId == current.assetId && prior.playing && current.playing &&
                    current.position > prior.position && current.position - prior.position <= (now - prior.elapsedMs) / 1_000.0 * 1.5 + 1) {
                    if (current.assetId == assetId && current.sdkLive && prior.sdkLive) liveClockAdvancingMs += now - prior.elapsedMs
                    else if (current.assetId == assetId && !current.sdkLive && !prior.sdkLive) postEndlistClockAdvancingMs += now - prior.elapsedMs
                    else if (phase == "archive") archiveClockAdvancingMs += now - prior.elapsedMs
                }
                previous = current
                playing = current.playing
                item.put("assetId", current.assetId ?: JSONObject.NULL).put("playing", playing)
                    .put("paused", session.player.isPaused).put("sdkLive", session.player.isLive)
                    .put("positionMs", current.position.takeIf { it.isFinite() }?.let { (it * 1_000).toLong() } ?: JSONObject.NULL)
                    .put("eventStatus", state.selectedEvent?.status?.name ?: JSONObject.NULL)
                    .put("archiveStatus", state.selectedEvent?.archiveStatus?.name ?: JSONObject.NULL)
                    .put("sdkAbsoluteOffsetSeconds", session.player.playbackTimeOffsetToAbsoluteTime.takeIf { it.isFinite() } ?: JSONObject.NULL)
                    .put("freshMappedUtcMs", session.viewedUtcForCurrentSource() ?: JSONObject.NULL)
                    .put("diagnosticEntries", session.diagnostics.entries.size).put("handoffEntries", session.handoffs.size)
            }
            if (playing && now - lastFrameMs >= 15_000L) {
                val hash = videoFingerprint(scenario)
                if (lastFrame != null && lastFrame != hash) { frameChanges++; lastFrameChangeMs = now }
                if (lastFrame == null) lastFrameChangeMs = now
                assertTrue("The playing video surface must not remain frozen for a minute", now - lastFrameChangeMs <= 60_000L)
                lastFrame = hash
                lastFrameMs = now
                item.put("frameSha256", hash)
            }
            if (force || observationCount == 0 || now - startedElapsedMs - observations.last().getLong("elapsedMs") >= 15_000L) {
                val memory = Debug.MemoryInfo().also(Debug::getMemoryInfo)
                val runtime = Runtime.getRuntime()
                val heap = runtime.totalMemory() - runtime.freeMemory()
                val thermal = if (Build.VERSION.SDK_INT >= 29)
                    instrumentationContext().getSystemService(PowerManager::class.java).currentThermalStatus else null
                maximumPssKb = maxOf(maximumPssKb, memory.totalPss)
                maximumHeapBytes = maxOf(maximumHeapBytes, heap)
                if (thermal != null) maximumThermalStatus = maxOf(maximumThermalStatus ?: thermal, thermal)
                item.put("appPssKb", memory.totalPss).put("appUsedHeapBytes", heap).put("deviceThermalStatus", thermal ?: JSONObject.NULL)
                if (observations.size == 200) observations.removeFirst()
                observations.addLast(item)
                observationCount++
                InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("enduranceObservation", item.toString()) })
            }
        }
        private fun instrumentationContext() = InstrumentationRegistry.getInstrumentation().targetContext
        fun writeReceipt() {
            val receipt = JSONObject().put("schemaVersion", 1).put("status", if (passed) "passed" else "failed")
                .put("protocol", protocol.name).put("liveAssetId", assetId).put("startedAtEpochMs", startedAtMs)
                .put("elapsedWallMs", SystemClock.elapsedRealtime() - startedElapsedMs)
                .put("measurementWallMs", SystemClock.elapsedRealtime() - measurementStarted).put("targetWallMs", targetMs)
                .put("liveClockAdvancingSampleMs", liveClockAdvancingMs).put("archiveClockAdvancingSampleMs", archiveClockAdvancingMs)
                .put("postEndlistClockAdvancingSampleMs", postEndlistClockAdvancingMs)
                .put("changedVideoFrameSamples", frameChanges).put("pauseResumeVerified", pauseResumeVerified)
                .put("expiredWindowRecoveryVerified", expiredWindowRecoveryVerified).put("endedBeforeReadyVerified", endedBeforeReadyVerified)
                .put("archiveHandoffVerified", archiveHandoffVerified).put("maximumAppPssKb", maximumPssKb)
                .put("maximumAppUsedHeapBytes", maximumHeapBytes).put("maximumObservedDeviceThermalStatus", maximumThermalStatus ?: JSONObject.NULL)
                .put("observationsTotal", observationCount).put("observationsRetained", observations.size)
                .put("observations", JSONArray(observations.toList()))
                .put("scope", "One app process; sampled pixels and clocks; no receiver quality, whole-device logs, memory-leak or thermal certification")
            File(instrumentationContext().filesDir, "endurance").apply { mkdirs() }
                .resolve("${protocol.name.lowercase()}.json").writeText(receipt.toString(2))
            val summary = JSONObject(receipt.toString()).apply { remove("observations") }
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                putString("enduranceResult", summary.toString())
            })
        }
    }
    private data class ClockSample(val elapsedMs: Long, val assetId: String?, val position: Double, val playing: Boolean, val sdkLive: Boolean)
}
