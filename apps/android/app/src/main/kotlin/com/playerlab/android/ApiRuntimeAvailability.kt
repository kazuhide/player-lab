package com.playerlab.android

import android.os.Handler
import android.os.Looper
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.TextureView
import android.view.ViewTreeObserver
import androidx.compose.runtime.*
import com.bitmovin.player.api.advertising.AdSourceType
import com.bitmovin.player.api.source.LoadingState
import com.bitmovin.player.api.ssai.SsaiAd
import com.bitmovin.player.api.ssai.SsaiAdBreak

/** SDK events update eligibility independently of the optional event recording switch. No polling. */
@Composable
internal fun rememberApiCommandCapabilities(controller: PlayerController, context: ApiRuntimeContext, dispatchRevision: Int): ApiCommandCapabilities {
    var capabilities by remember(controller, context) { mutableStateOf(apiCommandCapabilities(controller)) }
    LaunchedEffect(dispatchRevision, context) { capabilities = apiCommandCapabilities(controller) }
    val owner = controller.player
    DisposableEffect(controller, context, owner) {
        val active = java.util.concurrent.atomic.AtomicBoolean(true)
        val handler = Handler(Looper.getMainLooper())
        val refresh = Runnable {
            if (active.get() && controller.player === owner) capabilities = apiCommandCapabilities(controller)
        }
        val report: (String, Long) -> Unit = { _, _ ->
            if (Looper.myLooper() == Looper.getMainLooper()) refresh.run() else handler.post(refresh)
        }
        val subscriptions = mutableListOf<() -> Unit>()
        ApiEvents.player.filter { it.id in availabilityPlayerEvents }.forEach { subscriptions += it.subscribe(owner, report) }
        controller.configuredSource?.let { source ->
            ApiEvents.source.filter { it.id in setOf("SourceEvent.Loaded", "SourceEvent.Unloaded", "SourceEvent.Error") }
                .forEach { subscriptions += it.subscribe(source, report) }
        }
        controller.currentView()?.let { view ->
            ApiEvents.views.filter { it.id in availabilityViewEvents }.forEach { subscriptions += it.subscribe(view, false, report) }
            // Surface validity can change while playback is paused and no SDK clock event is emitted.
            var observedHolder: SurfaceHolder? = null
            val callback = object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) { if (active.get()) handler.post(refresh) }
                override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) { if (active.get()) handler.post(refresh) }
                override fun surfaceDestroyed(holder: SurfaceHolder) { if (active.get()) handler.post(refresh) }
            }
            fun observeHolder() {
                val holder = findApiRenderView<SurfaceView>(view)?.holder
                if (holder !== observedHolder) {
                    observedHolder?.removeCallback(callback)
                    observedHolder = holder
                    holder?.addCallback(callback)
                }
            }
            val tree = view.viewTreeObserver
            val layout = ViewTreeObserver.OnGlobalLayoutListener { if (active.get()) { observeHolder(); refresh.run() } }
            tree.addOnGlobalLayoutListener(layout)
            observeHolder()
            subscriptions += {
                val currentTree = if (tree.isAlive) tree else view.viewTreeObserver
                if (currentTree.isAlive) currentTree.removeOnGlobalLayoutListener(layout)
                observedHolder?.removeCallback(callback)
            }
        }
        refresh.run()
        onDispose {
            active.set(false)
            handler.removeCallbacks(refresh)
            subscriptions.forEach { it() }
        }
    }
    // Metadata objects are Compose state, unlike the SDK's advertising properties.
    return capabilities.copy(hasSsaiAds = controller.apiSsaiAds.isNotEmpty(), hasSsaiBreaks = controller.apiSsaiBreaks.isNotEmpty(),
        viewAttached = controller.currentView() != null, viewRecoverable = controller.apiHasRecoverableView,
        customMessageHandlerInstalled = controller.apiHasCustomMessageHandler,
        vrRendererAvailable = controller.apiVrRenderer != null, vrCallbackHandles = controller.apiVrCallbackHandles,
        nonLinearAdPresented = controller.apiActiveNonLinearAd != null)
}

private val availabilityPlayerEvents = setOf("PlayerEvent.Ready", "PlayerEvent.Active", "PlayerEvent.Inactive",
    "PlayerEvent.Error", "PlayerEvent.Destroy", "PlayerEvent.TimeChanged", "PlayerEvent.PlaylistTransition",
    "PlayerEvent.AdStarted", "PlayerEvent.AdFinished", "PlayerEvent.AdSkipped", "PlayerEvent.AdBreakStarted",
    "PlayerEvent.AdBreakFinished", "PlayerEvent.AdScheduleChanged", "PlayerEvent.CastAvailable", "PlayerEvent.CastStarted",
    "PlayerEvent.CastStopped", "PlayerEvent.SourceAdded", "PlayerEvent.SourceRemoved", "PlayerEvent.NonLinearAdStarted",
    "PlayerEvent.NonLinearAdSkipped", "PlayerEvent.NonLinearAdFinished")
private val availabilityViewEvents = setOf("PlayerEvent.FullscreenEnter", "PlayerEvent.FullscreenExit",
    "PlayerEvent.PictureInPictureEntered", "PlayerEvent.PictureInPictureExited", "PlayerEvent.PictureInPictureAvailabilityChanged")

internal fun apiCommandCapabilities(controller: PlayerController): ApiCommandCapabilities {
    val player = controller.player
    if (player.isDestroyed) return ApiCommandCapabilities(playerAvailable = false)
    val source = player.source
    val ad = player.ads.activeLinearAd
    val adClientType = controller.apiActiveAdClientType.takeIf { ad != null && controller.apiActiveAd === ad }
    val view = controller.currentView()
    return ApiCommandCapabilities(
        sourceAttached = source != null && source === controller.configuredSource && source.isAttachedToPlayer,
        sourceLoaded = source != null && source === controller.configuredSource && source.loadingState == LoadingState.Loaded,
        isLive = player.isLive,
        liveRewindAvailable = player.config.playbackConfig.isTimeShiftEnabled && player.maxTimeShift.isFinite() && player.maxTimeShift < 0.0,
        casting = player.isCasting,
        castAvailable = player.isCastAvailable,
        viewAttached = view != null,
        viewRecoverable = controller.apiHasRecoverableView,
        customMessageHandlerInstalled = controller.apiHasCustomMessageHandler,
        nagraConfigured = apiNagraConfigApplied(controller.apiOverrides.values),
        gyroscopicProviderAvailable = player.vr.gyroscopicOrientationProvider != null,
        touchProviderAvailable = player.vr.touchOrientationProvider != null,
        vrRendererAvailable = controller.apiVrRenderer != null,
        vrCallbackHandles = controller.apiVrCallbackHandles,
        surfaceReady = view?.let { findApiRenderView<SurfaceView>(it)?.holder?.surface?.isValid } == true,
        textureViewAvailable = view?.let { findApiRenderView<TextureView>(it) } != null,
        fullscreen = view?.isFullscreen == true,
        pictureInPicture = view?.isPictureInPicture == true,
        pictureInPictureAvailable = view?.isPictureInPictureAvailable == true,
        activeAd = ad != null,
        clientAdCallbacksAvailable = adClientType == AdSourceType.Bitmovin,
        // A manual SSAI marker does not establish an ad-relative clock or a media skip implementation.
        skippableAd = ad != null && ad !is SsaiAd && ad.skippableAfter?.let { player.currentTime >= it } == true &&
            (adClientType == AdSourceType.Bitmovin || adClientType == AdSourceType.Ima && ad.uiConfig?.requestsUi == false),
        activeSsaiAd = ad is SsaiAd,
        nonLinearAdPresented = controller.apiActiveNonLinearAd != null,
        activeSsaiBreak = player.ads.activeAdBreak is SsaiAdBreak,
        hasSsaiAds = controller.apiSsaiAds.isNotEmpty(),
        hasSsaiBreaks = controller.apiSsaiBreaks.isNotEmpty(),
        playlistSize = player.playlist.sources.size,
    )
}
