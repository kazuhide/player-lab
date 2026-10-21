package com.playerlab.android

import android.view.Surface
import android.view.SurfaceHolder
import android.view.View
import android.view.ViewGroup
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.Player

internal inline fun <reified T : View> findApiRenderView(root: View): T? {
    val pending = ArrayDeque<View>()
    pending.add(root)
    while (pending.isNotEmpty()) {
        val view = pending.removeFirst()
        if (view is T) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) pending.add(view.getChildAt(index))
    }
    return null
}

/** A raw Surface needs explicit clearing; the SurfaceHolder overload tracks its own lifecycle. */
internal class ApiSurfaceBinding {
    private var view: PlayerView? = null
    private var holder: SurfaceHolder? = null
    private var callback: SurfaceHolder.Callback? = null
    private var releaseSurface: (() -> Unit)? = null

    fun bind(view: PlayerView, holder: SurfaceHolder, player: Player, owns: () -> Boolean) {
        clear()
        check(holder.surface.isValid) { "The current video surface is not ready." }
        this.view = view
        this.holder = holder
        val surface = holder.surface
        val listener = object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {}
            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                if (this@ApiSurfaceBinding.holder === holder) clear()
            }
        }
        callback = listener
        releaseSurface = { if (owns()) player.setSurface(null as Surface?) }
        holder.addCallback(listener)
        try { player.setSurface(surface) } catch (failure: Exception) { clear(); throw failure }
    }
    fun clear(retiredView: PlayerView? = null) {
        if (retiredView != null && view !== retiredView) return
        val release = releaseSurface
        val previousHolder = holder
        val previousCallback = callback
        view = null; holder = null; callback = null; releaseSurface = null
        if (previousHolder != null && previousCallback != null) previousHolder.removeCallback(previousCallback)
        release?.invoke()
    }
}
