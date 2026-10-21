package com.playerlab.android

import com.bitmovin.player.api.LoadErrorFallbackConfig
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.decoder.DecoderPriorityProvider
import com.bitmovin.player.api.media.Quality
import com.bitmovin.player.api.media.Track
import com.bitmovin.player.api.media.audio.AudioLabeler
import com.bitmovin.player.api.media.audio.quality.AudioQualityLabeler
import com.bitmovin.player.api.media.subtitle.ForcedSubtitleCallback
import com.bitmovin.player.api.media.subtitle.SubtitleLabeler
import com.bitmovin.player.api.media.subtitle.SubtitleTrack
import com.bitmovin.player.api.media.video.quality.VideoQualityLabeler
import com.bitmovin.player.api.network.*
import com.bitmovin.player.api.recovery.*
import java.util.concurrent.Future
import java.util.concurrent.FutureTask

internal object ApiScriptSettings {
    private const val SDK = "android:com.bitmovin.player.api."
    private const val GUIDE = "Enter a JavaScript function body using input, or null to disable. Runs only after Apply. No Java, network, storage or Player/Source access is provided. Invalid results retain native behavior. "
    internal fun script(id: String, help: String, example: String,
                       player: ((PlayerConfig, String, ApiCallbackContext) -> PlayerConfig)? = null,
                       source: ((com.bitmovin.player.api.source.SourceConfig, String, ApiCallbackContext) -> Unit)? = null) =
        ApiSetting(SDK + id, id.substringBeforeLast('.'), ApiValueKind.Script, GUIDE + help + " Example: " + example,
            nullable = true, order = 100, playerCallback = player, sourceCallback = source,
            code = { value ->
                val body = kotlinString(if (value == "null") "null" else "<YOUR_CALLBACK_BODY>")
                if (player != null) "playerConfig = ApiScriptSettings.playerOverride(playerConfig, ${kotlinString(SDK + id)}, $body, callbackContext)"
                else "ApiScriptSettings.sourceOverride(sourceConfig, ${kotlinString(SDK + id)}, $body, callbackContext)"
            })
    fun playerOverride(config: PlayerConfig, id: String, body: String, callbacks: ApiCallbackContext): PlayerConfig =
        requireNotNull(fields.first { it.id == id }.playerCallback)(config, body, callbacks)
    fun sourceOverride(config: com.bitmovin.player.api.source.SourceConfig, id: String, body: String, callbacks: ApiCallbackContext) {
        requireNotNull(fields.first { it.id == id }.sourceCallback)(config, body, callbacks)
    }
    private fun program(value: String) = if (value == "null") null else ApiScriptProgram(value)
    private fun text(value: Any?): String? = if (value == null) null else (value as? String ?: error("Return a string or null.")).also { require(it.length <= 8192) }
    private fun bool(value: Any?) = value as? Boolean ?: error("Return a boolean.")
    private fun number(value: Any?): Double? = if (value == null) null else (value as? Number)?.toDouble()?.also { require(it.isFinite() && it >= 0) } ?: error("Return a nonnegative number or null.")
    private fun exception(value: Exception) = mapOf("name" to value.javaClass.simpleName, "message" to value.message?.take(2048))
    private fun track(value: Track) = mapOf("id" to value.id, "label" to value.label, "url" to value.url,
        "type" to value.type?.name, "isDefault" to value.isDefault,
        "roles" to value.roles.map { mapOf("id" to it.id, "schemeIdUri" to it.schemeIdUri, "value" to it.value) })
    private fun subtitle(value: SubtitleTrack) = track(value) + mapOf("language" to value.language,
        "associatedLanguage" to value.associatedLanguage, "mimeType" to value.mimeType, "isForced" to value.isForced)
    private fun quality(value: Quality) = mapOf("id" to value.id, "label" to value.label, "bitrate" to value.bitrate,
        "averageBitrate" to value.averageBitrate, "peakBitrate" to value.peakBitrate, "codec" to value.codec)
    private fun bytes(value: ByteArray?): List<Int>? = value?.takeIf { it.size <= 65_536 }?.map { it.toInt() and 255 }
    private fun decodedBytes(value: Any?): ByteArray? = if (value == null) null else {
        val list = value as? List<*> ?: error("Return byte arrays as integers from 0 through 255.")
        require(list.size <= 65_536)
        list.map { item ->
            val n = (item as? Number)?.toDouble() ?: error("Byte must be numeric.")
            require(n in 0.0..255.0 && n % 1.0 == 0.0)
            n.toInt().toByte()
        }.toByteArray()
    }
    private fun request(value: HttpRequest): Map<String, Any?> = linkedMapOf<String, Any?>(
        "url" to value.url, "method" to value.method, "headers" to value.headers,
        "bodyLength" to (value.body?.size ?: 0)).apply {
            val body = value.body
            if (body == null || body.size <= 65_536) put("body", bytes(body))
        }
    private fun decodedRequest(value: Any?, original: HttpRequest): HttpRequest? {
        if (value == null) return null
        val map = value as? Map<*, *> ?: error("Return an HTTP request value object or null.")
        require(map.keys.all { it in listOf("url", "method", "headers", "body", "bodyLength") })
        val url = map["url"]?.let(::text) ?: original.url
        require(url.startsWith("https://") || url.startsWith("http://"))
        val method = map["method"]?.let(::text) ?: original.method
        require(method in listOf("GET", "POST", "HEAD"))
        val headers = if (!map.containsKey("headers")) original.headers else if (map["headers"] == null) null else {
            val entries = map["headers"] as? Map<*, *> ?: error("Headers must be a string map.")
            require(entries.size <= 128)
            entries.map { (key, item) ->
                require(key is String && key.isNotBlank() && key.none { it == '\r' || it == '\n' })
                val entry = requireNotNull(text(item)); require(entry.none { it == '\r' || it == '\n' })
                key to entry
            }.toMap()
        }
        return HttpRequest(url, headers, if (map.containsKey("body")) decodedBytes(map["body"]) else original.body, method)
    }
    private fun <T> ready(value: T): Future<T> = FutureTask<T> { value }.apply { run() }
    private fun retryAction(value: RetryPlaybackAction): Map<String, Any?> = when (value) {
        RetryPlaybackAction.None -> mapOf("type" to "None")
        RetryPlaybackAction.Retry -> mapOf("type" to "Retry")
        RetryPlaybackAction.DisableMainContentDecodingDuringAds -> mapOf("type" to "DisableMainContentDecodingDuringAds")
        RetryPlaybackAction.SkipToNextSource -> mapOf("type" to "SkipToNextSource")
        is RetryPlaybackAction.LimitBitrate -> mapOf("type" to "LimitBitrate", "maxBitrate" to value.maxBitrate)
    }
    private fun decodedRetryAction(value: Any?): RetryPlaybackAction {
        val map = value as? Map<*, *>
        return when (val type = if (value is String) value else map?.get("type")) {
            "None" -> RetryPlaybackAction.None
            "Retry" -> RetryPlaybackAction.Retry
            "DisableMainContentDecodingDuringAds" -> RetryPlaybackAction.DisableMainContentDecodingDuringAds
            "SkipToNextSource" -> RetryPlaybackAction.SkipToNextSource
            "LimitBitrate" -> {
                val bitrate = (map?.get("maxBitrate") as? Number)?.toDouble() ?: error("Supply maxBitrate.")
                require(bitrate in 0.0..Int.MAX_VALUE.toDouble() && bitrate % 1.0 == 0.0)
                RetryPlaybackAction.LimitBitrate(bitrate.toInt())
            }
            else -> error("Unsupported retry action: ${type is String}")
        }
    }

    val fields = listOf(
        script("network.NetworkConfig.preprocessHttpRequestCallback", "input: {type, request: {url, method, headers, body, bodyLength}}. Return a modified request object or null to keep it. Body is a byte array (up to 65536 bytes); larger bodies are omitted and retained unless replaced.", "input.request.headers = {'X-Test': 'sample'}; return input.request;",
            player = { c, v, scope ->
                val p = program(v)
                c.copy(networkConfig = c.networkConfig.copy(preprocessHttpRequestCallback = p?.let {
                    PreprocessHttpRequestCallback { type, request -> scope.apply(SDK + "network.NetworkConfig.preprocessHttpRequestCallback", p,
                        mapOf("type" to type.name, "request" to request(request)), null as HttpRequest?) { decodedRequest(it, request) }?.let(::ready) }
                }))
            }),
        script("network.NetworkConfig.preprocessHttpResponseCallback", "input: {type, response: {url, status, headers, body, bodyLength}}. Return {body: [bytes]} or null to retain the response. Large bodies are omitted. The SDK buffers whole responses for this hook; narrow TweaksConfig.httpResponseTypesToPreprocess to avoid buffering media segments.", "return null;",
            player = { c, v, scope ->
                val p = program(v)
                c.copy(networkConfig = c.networkConfig.copy(preprocessHttpResponseCallback = p?.let {
                    PreprocessHttpResponseCallback { type, response ->
                        val input = linkedMapOf<String, Any?>("url" to response.url, "status" to response.status, "headers" to response.headers, "bodyLength" to response.body.size)
                        if (response.body.size <= 65_536) input["body"] = bytes(response.body)
                        scope.apply(SDK + "network.NetworkConfig.preprocessHttpResponseCallback", p, mapOf("type" to type.name, "response" to input), null as HttpResponse?) { result ->
                            if (result == null) null else {
                                val values = result as? Map<*, *> ?: error("Return a response object or null.")
                                response.copy(body = if (values.containsKey("body")) requireNotNull(decodedBytes(values["body"])) else response.body)
                            }
                        }?.let(::ready)
                    }
                }))
            }),
        script("network.RetryHttpRequestConfig.Custom.retryTimeoutCallback", "input: {currentRetryCount, httpRequestType, httpRequest, exception: {name, message}}. Return seconds or null to stop retries.", "return input.currentRetryCount < 2 ? 0.25 : null;",
            player = { c, v, scope ->
                val p = program(v)
                c.copy(networkConfig = c.networkConfig.copy(retryHttpRequestConfig = if (p == null) RetryHttpRequestConfig.LinearIncreasingBackoffRetry else RetryHttpRequestConfig.Custom { context ->
                    scope.apply(SDK + "network.RetryHttpRequestConfig.Custom.retryTimeoutCallback", p, mapOf("currentRetryCount" to context.currentRetryCount,
                        "httpRequestType" to context.httpRequestType.name, "httpRequest" to request(context.httpRequest), "exception" to exception(context.exception)), null as Double?, ::number)
                }))
            }),
        script("PlaybackConfig.forcedSubtitleCallback", "input is subtitle track metadata. Return a boolean.", "return input.isForced || input.language === 'en';",
            player = { c, v, scope -> val p = program(v); c.copy(playbackConfig = c.playbackConfig.copy(forcedSubtitleCallback = p?.let { ForcedSubtitleCallback { track ->
                scope.apply(SDK + "PlaybackConfig.forcedSubtitleCallback", p, subtitle(track), track.isForced, ::bool)
            } })) }),
        script("decoder.DecoderConfig.decoderPriorityProvider", "input: {context: {mediaType, isAd}, decoders: [{index, name, isSoftware}]}. Return unique decoder indexes in the order to try; omitted indexes are filtered out.", "return input.decoders.map(function(d) { return d.index; });",
            player = { c, v, scope -> val p = program(v); c.copy(playbackConfig = c.playbackConfig.copy(decoderConfig = c.playbackConfig.decoderConfig.copy(decoderPriorityProvider = p?.let {
                DecoderPriorityProvider { context, decoders ->
                    scope.apply(SDK + "decoder.DecoderConfig.decoderPriorityProvider", p, mapOf("context" to mapOf("mediaType" to context.mediaType.name, "isAd" to context.isAd),
                        "decoders" to decoders.mapIndexed { index, item -> mapOf("index" to index, "name" to item.name, "isSoftware" to item.isSoftware) }), decoders) { result ->
                        val list = result as? List<*> ?: error("Return decoder indexes.")
                        val indexes = list.map { index -> val n = (index as? Number)?.toDouble() ?: error("Index must be numeric."); require(n % 1.0 == 0.0 && n >= 0 && n < decoders.size); n.toInt() }
                        require(indexes.distinct().size == indexes.size)
                        indexes.map { decoders[it] }
                    }
                }
            }))) }),
        script("LoadErrorFallbackConfig.Custom.callback", "input: {name, message} of the IOException. Return whether to load the next source.", "return false;",
            player = { c, v, scope -> val p = program(v); c.copy(tweaksConfig = c.tweaksConfig.copy(loadErrorFallbackConfig = if (p == null) null else LoadErrorFallbackConfig.Custom { error ->
                scope.apply(SDK + "LoadErrorFallbackConfig.Custom.callback", p, exception(error), false, ::bool)
            })) }),
        script("recovery.RetryPlaybackConfig.retryPlaybackCallback", "input includes error code, playbackQuality, attemptedActions and suggestedAction. SDK objects are not passed to this worker-thread hook. Return None, Retry, DisableMainContentDecodingDuringAds, SkipToNextSource, or {type: 'LimitBitrate', maxBitrate: bitsPerSecond}.", "return input.suggestedAction;",
            player = { c, v, scope -> val p = program(v); c.copy(tweaksConfig = c.tweaksConfig.copy(retryPlaybackConfig = if (p == null) com.bitmovin.player.api.TweaksConfig().retryPlaybackConfig else RetryPlaybackConfig { context ->
                scope.apply(SDK + "recovery.RetryPlaybackConfig.retryPlaybackCallback", p, mapOf("errorCode" to context.errorEvent.code.value,
                    "playbackQuality" to context.playbackQuality?.let(::quality), "attemptedActions" to context.attemptedActions.map(::retryAction), "suggestedAction" to retryAction(context.suggestedAction)),
                    RetryPlaybackAction.None as RetryPlaybackAction, ::decodedRetryAction)
            })) }),
        script("media.LabelingConfig.audioLabeler", "input is audio track metadata, including language. Return the label string, or null to leave it unchanged.", "return input.language + ' audio';",
            source = { c, v, scope -> val p = program(v); c.labelingConfig = c.labelingConfig.copy(audioLabeler = p?.let { AudioLabeler { item ->
                scope.apply(SDK + "media.LabelingConfig.audioLabeler", p, track(item) + mapOf("language" to item.language, "associatedLanguage" to item.associatedLanguage), null as String?, ::text)
            } }) }),
        script("media.LabelingConfig.subtitleLabeler", "input is subtitle track metadata, including language and isForced. Return a label string or null.", "return input.language + ' captions';",
            source = { c, v, scope -> val p = program(v); c.labelingConfig = c.labelingConfig.copy(subtitleLabeler = p?.let { SubtitleLabeler { item ->
                scope.apply(SDK + "media.LabelingConfig.subtitleLabeler", p, subtitle(item), null as String?, ::text)
            } }) }),
        script("media.LabelingConfig.videoQualityLabeler", "input is quality metadata, including width, height and frameRate. Return a label string or null.", "return input.height + 'p';",
            source = { c, v, scope -> val p = program(v); c.labelingConfig = c.labelingConfig.copy(videoQualityLabeler = p?.let { VideoQualityLabeler { item ->
                scope.apply(SDK + "media.LabelingConfig.videoQualityLabeler", p, quality(item) + mapOf("width" to item.width, "height" to item.height, "frameRate" to item.frameRate), null as String?, ::text)
            } }) }),
        script("media.LabelingConfig.audioQualityLabeler", "input is quality metadata, including channelCount. Return a label string or null.", "return input.bitrate + ' bps';",
            source = { c, v, scope -> val p = program(v); c.labelingConfig = c.labelingConfig.copy(audioQualityLabeler = p?.let { AudioQualityLabeler { item ->
                scope.apply(SDK + "media.LabelingConfig.audioQualityLabeler", p, quality(item) + mapOf("channelCount" to item.channelCount), null as String?, ::text)
            } }) }),
    ) + ApiAdvertisingScripts.fields + ApiImaScripts.fields
}
