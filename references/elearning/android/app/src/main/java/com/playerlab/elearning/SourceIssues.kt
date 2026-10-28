package com.playerlab.elearning

import com.bitmovin.player.api.deficiency.SourceWarningCode
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.network.HttpRequestType

internal fun Source.reportPublicIssues(lessonId: String, report: (PlaybackIssue) -> Unit) {
    checkMainThread()
    val externalCaptionUrls = config.subtitleTracks.mapNotNull { it.url }.toSet()
    on(SourceEvent.Warning::class) { event ->
        val kind = when (event.code) {
            SourceWarningCode.SubtitleLoadingFailed -> PlaybackIssueKind.SUBTITLE_LOAD_WARNING
            SourceWarningCode.SubtitleParsingFailed -> PlaybackIssueKind.SUBTITLE_PARSE_WARNING
            else -> PlaybackIssueKind.SDK_WARNING
        }
        // SDK messages, deficiency payloads and request URLs never enter the app's diagnostics.
        report(PlaybackIssue(kind, event.code.value, lessonId))
    }
    on(SourceEvent.Error::class) { event -> report(PlaybackIssue(PlaybackIssueKind.MEDIA_ERROR, event.code.value, lessonId)) }
    on(SourceEvent.DownloadFinished::class) { event ->
        val externalCaption = event.url in externalCaptionUrls
        if ((event.downloadType == HttpRequestType.MediaSubtitles || externalCaption) && !event.isSuccess) {
            report(PlaybackIssue(PlaybackIssueKind.SUBTITLE_HTTP_FAILURE, null, lessonId, httpStatus = event.httpStatus.takeIf { it in 100..599 }))
        }
    }
}
