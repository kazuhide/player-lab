package com.playerlab.android

import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.decoder.DecoderPriorityProvider
import com.bitmovin.player.api.decoder.MediaCodecInfo
import com.bitmovin.player.api.media.MediaType
import com.bitmovin.player.api.media.subtitle.SubtitleTrack
import com.bitmovin.player.api.network.*
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ApiScriptSettingsTest {
    private fun id(value: String) = "android:com.bitmovin.player.api.$value"
    @Test fun requestAdapterCreatesTypedRequestAndPreservesUneditedFields() {
        val overrides = ApiOverrides.validate(mapOf(id("network.NetworkConfig.preprocessHttpRequestCallback") to
            "input.request.headers['X-Lab'] = input.type; input.request.body = [0, 128, 255]; return input.request;"))
        val scope = ApiCallbackContext()
        assertTrue(overrides.code().contains("val callbackContext = ApiCallbackContext()"))
        assertFalse(overrides.code().contains("X-Lab"))
        val callback = overrides.player(PlayerConfig(), scope).networkConfig.preprocessHttpRequestCallback!!
        val original = HttpRequest("https://example.invalid/manifest.mpd", mapOf("Accept" to "application/dash+xml"), null, "GET")
        val changed = callback.preprocessHttpRequest(HttpRequestType.entries.first(), original)!!.get()
        assertNotSame(original, changed)
        assertEquals(original.url, changed.url)
        assertEquals(original.headers!!["Accept"], changed.headers!!["Accept"])
        assertEquals(HttpRequestType.entries.first().name, changed.headers!!["X-Lab"])
        assertArrayEquals(byteArrayOf(0, -128, -1), changed.body)
        assertFalse(original.headers!!.containsKey("X-Lab"))
        scope.close()
        assertNull(callback.preprocessHttpRequest(HttpRequestType.entries.first(), original))
    }
    @Test fun responseAndRetryAdaptersPreserveNullAndRejectInvalidValues() {
        val overrides = ApiOverrides.validate(mapOf(
            id("network.NetworkConfig.preprocessHttpResponseCallback") to "return {body: input.response.body.concat([33])};",
            id("network.RetryHttpRequestConfig.Custom.retryTimeoutCallback") to "return input.currentRetryCount < 2 ? 0.5 : null;"))
        val network = overrides.player(PlayerConfig()).networkConfig
        val request = HttpRequest("https://example.invalid/manifest.mpd")
        val original = HttpResponse(request, request.url, 200, emptyMap(), byteArrayOf(65))
        val changed = network.preprocessHttpResponseCallback!!.preprocessHttpResponse(HttpRequestType.entries.first(), original)!!.get()
        assertArrayEquals(byteArrayOf(65, 33), changed.body)
        assertArrayEquals(byteArrayOf(65), original.body)
        val callback = (network.retryHttpRequestConfig as RetryHttpRequestConfig.Custom).retryTimeoutCallback
        fun context(count: Int) = RetryHttpRequestConfig.Custom.RetryContext(count, HttpRequestType.entries.first(), request, IOException("sample"))
        assertEquals(0.5, callback.getTimeout(context(1))!!, 0.0)
        assertNull(callback.getTimeout(context(2)))
    }
    @Test fun decoderReturnIndexesSelectOriginalNativeObjectsAndInvalidIndexesRetainDefault() {
        val scope = ApiCallbackContext()
        val overrides = ApiOverrides.validate(mapOf(id("decoder.DecoderConfig.decoderPriorityProvider") to
            "return input.context.isAd ? [1, 0] : [99];"))
        val callback = overrides.player(PlayerConfig(), scope).playbackConfig.decoderConfig.decoderPriorityProvider!!
        val first = MediaCodecInfo("hardware.sample", false)
        val second = MediaCodecInfo("software.sample", true)
        val list = listOf(first, second)
        val changed = callback.overrideDecodersPriority(DecoderPriorityProvider.DecoderContext(MediaType.Video, true), list)
        assertSame(second, changed[0]); assertSame(first, changed[1])
        assertSame(list, callback.overrideDecodersPriority(DecoderPriorityProvider.DecoderContext(MediaType.Video, false), list))
        assertEquals(2 to 1, scope.snapshot()[id("decoder.DecoderConfig.decoderPriorityProvider")])
    }
    @Test fun sourceLabelAndForcedSubtitleBodiesUseActualTypedMetadata() {
        val overrides = ApiOverrides.validate(mapOf(id("media.LabelingConfig.subtitleLabeler") to "return input.language + ':' + input.label;",
            id("PlaybackConfig.forcedSubtitleCallback") to "return input.language === 'en';"))
        val source = overrides.source(SourceConfig("https://example.invalid/a.m3u8", SourceType.Hls))
        val track = SubtitleTrack(url = "https://example.invalid/a.vtt", mimeType = "text/vtt", label = "English", id = "text", isDefault = false,
            language = "en", isForced = false, roles = emptyList(), associatedLanguage = null)
        assertEquals("en:English", source.labelingConfig.subtitleLabeler!!.getSubtitleLabel(track))
        assertTrue(overrides.player(PlayerConfig()).playbackConfig.forcedSubtitleCallback!!.isForcedSubtitle(track))
    }
    @Test fun invalidBudgetExceededAndRetiredRecoveryScriptsRetainTheActualSdkSuggestion() {
        val source = java.lang.reflect.Proxy.newProxyInstance(com.bitmovin.player.api.source.Source::class.java.classLoader, arrayOf(com.bitmovin.player.api.source.Source::class.java)) { _, _, _ -> null } as com.bitmovin.player.api.source.Source
        val suggested = com.bitmovin.player.api.recovery.RetryPlaybackAction.LimitBitrate(123456)
        val input = com.bitmovin.player.api.recovery.RetryPlaybackContext(
            com.bitmovin.player.api.event.SourceEvent.Error(com.bitmovin.player.api.deficiency.SourceErrorCode.General, "Synthetic"), null, source, emptyList(), suggested)
        for (body in listOf("return {type: 'invented'};", "while(true) {}")) {
            val scope = ApiCallbackContext()
            val overrides = ApiOverrides.validate(mapOf(id("recovery.RetryPlaybackConfig.retryPlaybackCallback") to body))
            val callback = overrides.player(PlayerConfig(), scope).tweaksConfig.retryPlaybackConfig.retryPlaybackCallback
            assertSame(suggested, callback.onPlaybackError(input))
            assertEquals(1 to 1, scope.snapshot()[id("recovery.RetryPlaybackConfig.retryPlaybackCallback")])
            scope.close(); assertSame(suggested, callback.onPlaybackError(input))
        }
        val explicitNone = ApiOverrides.validate(mapOf(id("recovery.RetryPlaybackConfig.retryPlaybackCallback") to "return 'None';"))
            .player(PlayerConfig()).tweaksConfig.retryPlaybackConfig.retryPlaybackCallback
        assertSame(com.bitmovin.player.api.recovery.RetryPlaybackAction.None, explicitNone.onPlaybackError(input))
    }
}
