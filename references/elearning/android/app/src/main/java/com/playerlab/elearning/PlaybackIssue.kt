package com.playerlab.elearning

enum class PlaybackIssueKind { MEDIA_ERROR, SUBTITLE_LOAD_WARNING, SUBTITLE_PARSE_WARNING, SDK_WARNING, SUBTITLE_HTTP_FAILURE, SUBTITLE_INVALID_FORMAT }
data class PlaybackIssue(val kind: PlaybackIssueKind, val sdkCode: Int?, val lessonId: String?, val currentSource: Boolean = true, val httpStatus: Int? = null) {
    init {
        require(sdkCode == null || sdkCode in 0..99_999)
        require(httpStatus == null || httpStatus in 100..599)
        require(lessonId == null || lessonId.matches(Regex("EDU-FX-[0-9]{2}")))
    }
}
internal fun hasWebVttSignature(body: ByteArray): Boolean {
    if (body.size > 1_048_576) return false
    val prefix = String(body, 0, minOf(body.size, 16), Charsets.UTF_8).removePrefix("\uFEFF")
    return prefix.startsWith("WEBVTT") && (prefix.length == 6 || prefix[6] in " \t\r\n")
}
enum class OwnedTestFault(val mediaPath: String? = null, val subtitlePath: String? = null) {
    NONE,
    MEDIA_404(mediaPath = "missing/hls/master.m3u8"),
    SUBTITLE_404(subtitlePath = "subtitles/absent.vtt"),
    MALFORMED_VTT(subtitlePath = "subtitles/malformed.vtt"),
}
