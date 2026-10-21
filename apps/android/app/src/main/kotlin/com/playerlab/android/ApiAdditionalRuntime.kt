package com.playerlab.android

import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.TextureView
import com.bitmovin.player.api.drm.NagraConnectConfig
import com.bitmovin.player.api.source.CmcdKey
import com.bitmovin.player.api.vr.orientation.ViewingDirection

internal object ApiAdditionalRuntime {
    private fun view(controller: PlayerController) = requireNotNull(controller.currentView()) { "Attach the current PlayerView first." }
    private fun orientationArguments() = listOf(ApiArgument("mode", "Manual", listOf("Original", "Manual", "None")),
        ApiArgument("yaw", "0"), ApiArgument("pitch", "0"), ApiArgument("roll", "0"), ApiArgument("enabled", "true", listOf("true", "false")))
    val commands = listOf(
        ApiCommand("android:com.bitmovin.player.api.Player.onStart()", listOf()) { c, _ -> c.player.onStart() },
        ApiCommand("android:com.bitmovin.player.api.Player.onResume()", listOf()) { c, _ -> c.player.onResume() },
        ApiCommand("android:com.bitmovin.player.api.Player.onPause()", listOf()) { c, _ -> c.player.onPause() },
        ApiCommand("android:com.bitmovin.player.api.Player.onStop()", listOf()) { c, _ -> c.player.onStop() },
        ApiCommand("android:com.bitmovin.player.api.Player.destroy()", listOf(), "Player.destroy and recreate current player") { c, _ -> c.applyPlayerSettings(c.playerSettings) },
        ApiCommand("android:com.bitmovin.player.PlayerView.onStart()", listOf()) { c, _ -> view(c).onStart() },
        ApiCommand("android:com.bitmovin.player.PlayerView.onResume()", listOf()) { c, _ -> view(c).onResume() },
        ApiCommand("android:com.bitmovin.player.PlayerView.onPause()", listOf()) { c, _ -> view(c).onPause() },
        ApiCommand("android:com.bitmovin.player.PlayerView.onStop()", listOf()) { c, _ -> view(c).onStop() },
        ApiCommand("android:com.bitmovin.player.PlayerView.onDestroy()", listOf(), "PlayerView.onDestroy and recreate current view") { c, _ -> c.recreateApiView() },
        ApiCommand("android:com.bitmovin.player.PlayerView.onPictureInPictureModeChanged()", listOf(ApiArgument("isInPictureInPictureMode", "false", listOf("true", "false")))) { c, i -> val view = view(c); view.onPictureInPictureModeChanged(i.bool("isInPictureInPictureMode"), view.resources.configuration) },
        ApiCommand("android:com.bitmovin.player.PlayerView.player", listOf(ApiArgument("attachCurrentPlayer", "true", listOf("true", "false")))) { c, i -> c.setApiViewAttached(i.bool("attachCurrentPlayer")) },
        ApiCommand("android:com.bitmovin.player.PlayerView.on()", listOf(ApiArgument("subscription", "view-events"), ApiArgument("event", "PlayerEvent.Play", ApiEvents.views.map { it.id }))) { c, i -> c.subscribeApiView(i.text("subscription"), i.text("event"), false) },
        ApiCommand("android:com.bitmovin.player.PlayerView.next()", listOf(ApiArgument("subscription", "view-once"), ApiArgument("event", "PlayerEvent.Play", ApiEvents.views.map { it.id }))) { c, i -> c.subscribeApiView(i.text("subscription"), i.text("event"), true) },
        ApiCommand("android:com.bitmovin.player.PlayerView.off()", listOf(ApiArgument("subscription", "view-events"))) { c, i -> c.unsubscribeApiView(i.text("subscription")) },
        ApiCommand("android:com.bitmovin.player.PlayerView.setFullscreenHandler()", listOf(ApiArgument("enabled", "true", listOf("true", "false")))) { c, i -> c.setApiFullscreenHandler(i.bool("enabled")) },
        ApiCommand("android:com.bitmovin.player.PlayerView.setPictureInPictureHandler()", listOf(ApiArgument("enabled", "true", listOf("true", "false")), ApiArgument("width", "16"), ApiArgument("height", "9"))) { c, i -> c.setApiPictureInPictureHandler(i.bool("enabled"), i.int("width", 1), i.int("height", 1)) },
        ApiCommand("android:com.bitmovin.player.PlayerView.setCustomMessageHandler()", listOf(ApiArgument("enabled", "true", listOf("true", "false")), ApiArgument("reply", "received"))) { c, i -> c.setApiCustomMessageHandler(i.bool("enabled"), i.text("reply")) },
        ApiCommand("app:custom-message-send", listOf(ApiArgument("name", "playerLabMessage"), ApiArgument("payload", "sample")), "Send message to custom Web UI") { c, i -> c.sendApiCustomMessage(i.text("name"), i.text("payload")) },
        ApiCommand("android:com.bitmovin.player.api.Player.setSurface()", listOf(ApiArgument("target", "SurfaceHolder", listOf("SurfaceHolder", "Surface", "None")))) { c, i ->
            val target = i.text("target")
            if (target == "None") { c.apiSurfaces.clear(); c.player.setSurface(null as SurfaceHolder?) } else {
                val view = view(c)
                val holder = requireNotNull(findApiRenderView<SurfaceView>(view)) { "Choose SurfaceView in PlayerViewConfig and Apply first." }.holder
                check(holder.surface.isValid)
                if (target == "SurfaceHolder") { c.apiSurfaces.clear(); c.player.setSurface(holder) } else {
                    require(target == "Surface")
                    val owner = c.player
                    c.apiSurfaces.bind(view, holder, owner) { c.player === owner && c.currentView() === view }
                }
            }
        },
        ApiCommand("android:com.bitmovin.player.api.Player.setTextureView()", listOf(ApiArgument("target", "Current TextureView", listOf("Current TextureView", "None")))) { c, i ->
            val target = if (i.text("target") == "None") null else requireNotNull(findApiRenderView<TextureView>(view(c))) { "Choose TextureView in PlayerViewConfig and Apply first." }
            c.apiSurfaces.clear()
            c.player.setTextureView(target)
        },
        ApiCommand("android:com.bitmovin.player.api.Player.setAdViewGroup()", listOf(ApiArgument("target", "Current PlayerView", listOf("Current PlayerView", "None")))) { c, i -> c.player.setAdViewGroup(if (i.text("target") == "None") null else view(c)) },
        ApiCommand("android:com.bitmovin.player.api.Player.preloadDrmLicense()", listOf(), "Player.preloadDrmLicense using applied NagraConnectConfig") { c, _ -> c.player.preloadDrmLicense(c.apiOverrides.source(c.sourceSettings.toSourceConfig()).drmConfig as? NagraConnectConfig ?: error("Configure NagraConnect before preloading its license.")) },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.gyroscopicOrientationProvider", orientationArguments()) { c, i -> setApiOrientation(c, "gyroscopic", i.text("mode"), ViewingDirection(i.number("yaw"), i.number("pitch"), i.number("roll")), i.bool("enabled")) },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.touchOrientationProvider", orientationArguments()) { c, i -> setApiOrientation(c, "touch", i.text("mode"), ViewingDirection(i.number("yaw"), i.number("pitch"), i.number("roll")), i.bool("enabled")) },
    )
    val reads = listOf(
        ApiRead("android:com.bitmovin.player.api.source.CmcdKey.key") { CmcdKey.Predefined.entries.associate { it.name to it.key } },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.Vector3.getPhi()") { c -> c.apiVector?.getPhi() },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.Vector3.getX()") { c -> c.apiVector?.getX() },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.Vector3.getY()") { c -> c.apiVector?.getY() },
    )
}
