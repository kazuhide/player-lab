package com.playerlab.android

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewParent
import android.widget.FrameLayout

/** Hosts player content without owning its playback or view lifecycle. */
internal class PlayerTouchHost(context: Context, val content: View) : FrameLayout(context) {
    private var touchParent: ViewParent? = null

    init {
        addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            releaseTouchOwnership()
            touchParent = parent
        }
        try {
            if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                touchParent?.requestDisallowInterceptTouchEvent(true)
            }
            val handled = super.dispatchTouchEvent(event)
            if (event.actionMasked == MotionEvent.ACTION_DOWN && !handled) releaseTouchOwnership()
            return handled
        } catch (failure: Throwable) {
            releaseTouchOwnership()
            throw failure
        } finally {
            if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
                releaseTouchOwnership()
            }
        }
    }

    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
        // Keep the gesture with player content even if a child resets its interception request.
        super.requestDisallowInterceptTouchEvent(disallowIntercept || touchParent != null)
    }

    fun releaseTouchOwnership() {
        val owner = touchParent
        touchParent = null
        owner?.requestDisallowInterceptTouchEvent(false)
    }

    override fun onDetachedFromWindow() {
        try { releaseTouchOwnership() } finally { super.onDetachedFromWindow() }
    }
}
