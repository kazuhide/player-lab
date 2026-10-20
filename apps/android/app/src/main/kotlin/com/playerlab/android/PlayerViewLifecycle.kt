package com.playerlab.android

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/** Host callbacks belong to the attached view and stop before that view is retired. */
internal class PlayerViewLifecycle(private val lifecycle: Lifecycle) {
    private val observers = mutableMapOf<Any, DefaultLifecycleObserver>()
    private var released = false

    fun attach(view: Any, onStart: () -> Unit, onResume: () -> Unit, onPause: () -> Unit, onStop: () -> Unit) {
        if (released) return
        detach(view)
        val observer = object : DefaultLifecycleObserver {
            private fun ownsView() = !released && observers[view] === this
            override fun onStart(owner: LifecycleOwner) { if (ownsView()) onStart() }
            override fun onResume(owner: LifecycleOwner) { if (ownsView()) onResume() }
            override fun onPause(owner: LifecycleOwner) { if (ownsView()) onPause() }
            override fun onStop(owner: LifecycleOwner) { if (ownsView()) onStop() }
        }
        observers[view] = observer
        // addObserver catches up a new view even when its Activity is already resumed.
        // SDK 3.171.0 player-ui-web-compose sources: ui/compose/wrapper/PlayerView.kt:97–107.
        lifecycle.addObserver(observer)
    }

    fun detach(view: Any) {
        observers.remove(view)?.let(lifecycle::removeObserver)
    }

    fun release() {
        released = true
        observers.values.forEach(lifecycle::removeObserver)
        observers.clear()
    }
}
