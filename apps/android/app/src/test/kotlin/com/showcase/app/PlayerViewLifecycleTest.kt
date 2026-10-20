package com.showcase.app

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerViewLifecycleTest {
    @Test
    fun forwardsHostTransitionsAndCatchesUpAResumedReplacement() {
        val owner = Host()
        val events = mutableListOf<String>()
        val binding = PlayerViewLifecycle(owner.lifecycle)
        val original = Any()
        owner.registry.currentState = Lifecycle.State.CREATED
        attach(binding, original, "original", events)
        assertEquals(emptyList<String>(), events)

        owner.registry.currentState = Lifecycle.State.RESUMED
        owner.registry.currentState = Lifecycle.State.CREATED
        owner.registry.currentState = Lifecycle.State.RESUMED
        assertEquals(listOf("original:start", "original:resume", "original:pause", "original:stop", "original:start", "original:resume"), events)

        val originalEvents = events.toList()
        binding.detach(original)
        assertEquals("Retiring a view must not pause its shared player", originalEvents, events)
        events.clear()
        val replacement = Any()
        attach(binding, replacement, "replacement", events)
        assertEquals(listOf("replacement:start", "replacement:resume"), events)
        assertEquals(1, owner.registry.observerCount)

        owner.registry.currentState = Lifecycle.State.CREATED
        assertEquals(listOf("replacement:pause", "replacement:stop"), events.takeLast(2))
        binding.detach(replacement)
        val retired = events.toList()
        owner.registry.currentState = Lifecycle.State.RESUMED
        assertEquals("Retired views must not receive later host events", retired, events)
        assertEquals(0, owner.registry.observerCount)
    }

    @Test
    fun releaseRemovesAllObserversAndRejectsLateViews() {
        val owner = Host()
        owner.registry.currentState = Lifecycle.State.RESUMED
        val events = mutableListOf<String>()
        val binding = PlayerViewLifecycle(owner.lifecycle)
        val original = Any()
        val replacement = Any()
        attach(binding, original, "original", events)
        binding.detach(original)
        attach(binding, replacement, "replacement", events)
        assertEquals(listOf("original:start", "original:resume", "replacement:start", "replacement:resume"), events)

        binding.release()
        binding.release()
        val retired = events.toList()
        attach(binding, Any(), "late", events)
        assertEquals("Release must remove observers immediately", 0, owner.registry.observerCount)
        owner.registry.currentState = Lifecycle.State.DESTROYED
        assertEquals("Released ownership must not restart destroyed views or players", retired, events)
        assertEquals(0, owner.registry.observerCount)
    }

    private fun attach(binding: PlayerViewLifecycle, view: Any, name: String, events: MutableList<String>) {
        binding.attach(
            view,
            onStart = { events += "$name:start" },
            onResume = { events += "$name:resume" },
            onPause = { events += "$name:pause" },
            onStop = { events += "$name:stop" },
        )
    }

    private class Host : LifecycleOwner {
        // The registry stays on this test thread; no Android main-loop mock is needed.
        val registry = LifecycleRegistry.createUnsafe(this)
        override val lifecycle: Lifecycle get() = registry
    }
}
