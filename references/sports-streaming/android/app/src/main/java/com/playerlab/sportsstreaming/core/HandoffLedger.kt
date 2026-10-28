package com.playerlab.sportsstreaming.core

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

enum class HandoffFailure(val wireValue: String) {
    LOAD_FAILED("load-failed"), POSITION_MISMATCH("position-mismatch"), DISCONNECTED("disconnected")
}
private data class HandoffRecord(
    val requestId: String, val requestedAtMs: Long, val eventId: String, val transition: String,
    val expected: RequestedPosition, var candidate: ConfirmedPosition? = null, var confirmed: ConfirmedPosition? = null,
    var failure: HandoffFailure? = null, var candidateObservedAtMs: Long? = null,
)
private data class RequestedPosition(val videoId: String, val positionMs: Long?, val playWhenReady: Boolean)
private data class ConfirmedPosition(val videoId: String, val positionMs: Long, val playWhenReady: Boolean, val advancing: Boolean)

/** Stores local observations only; no record is sent through Analytics customData. */
class HandoffLedger {
    private val records = ArrayDeque<HandoffRecord>(200)
    private var sequence = 0L
    val size get() = records.size

    fun begin(eventId: String, transition: String, videoId: String, positionMs: Long?,
              playWhenReady: Boolean, requestedAtMs: Long = System.currentTimeMillis()): String {
        require(transition in setOf("live-to-archive", "cast"))
        require(Regex("[A-Za-z0-9_.:-]{1,100}").matches(eventId))
        require(Regex("[A-Za-z0-9_.:-]{1,100}").matches(videoId))
        require(requestedAtMs >= 0 && (positionMs == null || positionMs >= 0))
        val id = "request-$requestedAtMs-${++sequence}"
        if (records.size == 200) records.removeFirst()
        records.addLast(HandoffRecord(id, requestedAtMs, eventId, transition,
            RequestedPosition(videoId, positionMs, playWhenReady)))
        return id
    }

    fun observe(requestId: String, videoId: String?, positionMs: Long?, isPlaying: Boolean,
                isPaused: Boolean, advancing: Boolean, readyStopped: Boolean = false,
                observedAtMs: Long = System.nanoTime() / 1_000_000L): Boolean {
        val record = records.firstOrNull { it.requestId == requestId } ?: return false
        if (record.failure != null) return false
        if (record.confirmed != null) return true
        val target = record.expected.positionMs ?: return false
        val expected = HandoffExpectation(record.expected.videoId, target, record.expected.playWhenReady)
        if (record.candidate == null && expected.matchesPosition(videoId, positionMs) &&
            (if (record.expected.playWhenReady) isPlaying else (isPaused || readyStopped) && !isPlaying)) {
            record.candidate = ConfirmedPosition(videoId!!, positionMs!!, record.expected.playWhenReady, false)
            record.candidateObservedAtMs = observedAtMs
        }
        val candidate = record.candidate ?: return false
        if (!record.expected.playWhenReady) {
            if (isPlaying || !expected.matchesPosition(videoId, positionMs)) return false
            if (!isPaused) {
                val elapsed = observedAtMs - (record.candidateObservedAtMs ?: return false)
                if (!readyStopped || isPlaying || videoId != candidate.videoId || positionMs == null ||
                    elapsed < 200 || kotlin.math.abs(positionMs - candidate.positionMs) > 250) return false
            }
            record.confirmed = candidate
            return true
        }
        if (videoId == candidate.videoId && isPlaying && !isPaused && advancing &&
            positionMs != null && positionMs > candidate.positionMs) {
            record.confirmed = candidate.copy(advancing = true)
            return true
        }
        return false
    }
    fun fail(requestId: String, failure: HandoffFailure) {
        records.firstOrNull { it.requestId == requestId && it.confirmed == null }?.failure = failure
    }
    fun exportJson(nowMs: Long = System.currentTimeMillis()): String {
        val first = records.minOfOrNull { it.requestedAtMs } ?: nowMs
        val end = maxOf(nowMs, records.maxOfOrNull { it.requestedAtMs } ?: nowMs)
        val rows = JSONArray()
        records.forEach { record ->
            val expected = record.expected
            rows.put(JSONObject().put("requestId", record.requestId).put("requestedAt", iso(record.requestedAtMs))
                .put("eventId", record.eventId).put("transition", record.transition)
                .put("requested", JSONObject().put("videoId", expected.videoId).put("positionMs", expected.positionMs ?: JSONObject.NULL)
                    .put("playWhenReady", expected.playWhenReady))
                .put("confirmed", record.confirmed?.let { actual ->
                    JSONObject().put("videoId", actual.videoId).put("positionMs", actual.positionMs)
                        .put("playWhenReady", actual.playWhenReady).put("positionAdvanced", actual.advancing)
                } ?: JSONObject.NULL)
                .put("failure", record.failure?.wireValue ?: JSONObject.NULL)
                .put("receiverQoe", JSONObject.NULL))
        }
        return JSONObject().put("schemaVersion", 1).put("source", "local-device-records")
            .put("period", JSONObject().put("start", iso(first)).put("end", iso(end)))
            .put("records", rows).toString(2)
    }
    private fun iso(milliseconds: Long) = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(milliseconds))
}
