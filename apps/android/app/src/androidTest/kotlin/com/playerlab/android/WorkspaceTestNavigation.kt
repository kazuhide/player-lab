package com.playerlab.android

import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.Window
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import java.util.concurrent.ConcurrentHashMap

internal typealias WorkspaceRule = AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

/** Uses the same visible selectors as a person; it never mutates controller or editor state. */
internal fun workspaceChoose(ui: WorkspaceRule, tag: String, value: String, search: String? = null) {
    workspaceCloseDialog(ui)
    // System keyboard dismissal can outlive Espresso's input connection. Wait for
    // its actual window transition before using a header restored from IME mode.
    closeSoftKeyboard()
    InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(100, 5_000)
    ui.waitForIdle()
    ui.waitUntil(5_000) { runCatching { ui.onNodeWithTag(tag).assertIsDisplayed() }.isSuccess }
    ui.onNodeWithTag(tag).assertIsDisplayed().performClick()
    if (search != null) {
        ui.onNodeWithTag("$tag-search").performTextReplacement(search)
    }
    val target = "$tag-option-$value"
    ui.onNodeWithTag("$tag-options").performScrollToNode(hasTestTag(target))
    ui.onNodeWithTag(target).assertIsDisplayed().performClick()
    workspaceWaitForPickerDismissal(ui, tag)
}

/** Waits for the real dialog and its keyboard to close before touching the restored editor. */
internal fun workspaceWaitForPickerDismissal(ui: WorkspaceRule, tag: String) {
    ui.waitUntil(5_000) { ui.onAllNodesWithTag("$tag-options").fetchSemanticsNodes().isEmpty() }
    InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(100, 5_000)
    closeSoftKeyboard()
    ui.waitUntil(5_000) { runCatching { ui.onNodeWithTag(tag).assertIsDisplayed() }.isSuccess }
    ui.waitForIdle()
}

internal fun workspaceTheme(ui: WorkspaceRule, label: String) {
    val mode = UiMode.entries.first { it.label == label || it == UiMode.LIVE && label == "Live (DVR)" }
    workspaceChoose(ui, "theme-selector", mode.name)
    ui.onNodeWithTag("theme-selector").assertTextContains(mode.label, substring = true)
    ui.onNodeWithTag("theme-selector").assertIsEnabled()
}

internal fun workspaceSource(ui: WorkspaceRule, label: String) {
    workspaceChoose(ui, "source-selector", Sources.all.first { it.label == label }.id)
}

internal fun workspaceSetting(ui: WorkspaceRule, id: String) {
    val item = configurationItems.first { it.id == id }
    workspaceCloseDialog(ui)
    ui.onNodeWithTag("workspace-settings").performClick()
    workspaceChoose(ui, "settings-page", item.group)
    workspaceChoose(ui, "configuration-setting", id, item.label)
}

internal fun workspaceConfigurationNode(ui: WorkspaceRule, tag: String): SemanticsNodeInteraction {
    val setting = when {
        tag.startsWith("source-type-") -> "source-type"
        tag.startsWith("source-reference-") -> "source-reference"
        else -> tag
    }
    workspaceSetting(ui, setting)
    return ui.onNodeWithTag(setting)
}

internal fun workspaceMore(ui: WorkspaceRule, page: String) {
    workspaceCloseDialog(ui)
    ui.onNodeWithTag("workspace-more").performClick()
    workspaceChoose(ui, "more-page", page)
}

internal fun workspaceSdkSetting(ui: WorkspaceRule, id: String) {
    workspaceCloseRecordEditors(ui)
    workspaceCloseDialog(ui)
    ui.onNodeWithTag("workspace-settings").performClick()
    workspaceChoose(ui, "settings-page", "SDK overrides")
    workspaceChoose(ui, "api-settings-category", apiPurpose(id))
    workspaceChoose(ui, "api-settings-field", id, id)
    ui.onNodeWithTag("api-settings-field").assertTextContains(apiDisplayName(id), substring = true)
}

internal fun workspaceCommand(ui: WorkspaceRule, id: String) {
    workspaceCloseDialog(ui)
    ui.onNodeWithTag("workspace-apis").performClick()
    ui.onNodeWithTag("api-section-Commands").performClick()
    workspaceChoose(ui, "api-command-category", apiPurpose(id))
    workspaceChoose(ui, "api-command-selector", id, id)
    ui.onNodeWithTag("api-run-target").assertTextContains(ApiRuntime.commands.first { it.id == id }.label, substring = true)
}

internal fun workspaceState(ui: WorkspaceRule, id: String): SemanticsNodeInteraction {
    workspaceCloseDialog(ui)
    ui.onNodeWithTag("workspace-apis").performClick()
    ui.onNodeWithTag("api-section-State").performClick()
    workspaceChoose(ui, "api-state-selector", id, id)
    ui.onNodeWithTag("api-state-refresh").assertIsDisplayed().performClick()
    return ui.onNodeWithTag("api-state-$id")
}

internal fun workspaceEvent(ui: WorkspaceRule, id: String): SemanticsNodeInteraction {
    workspaceCloseDialog(ui)
    ui.onNodeWithTag("workspace-apis").performClick()
    ui.onNodeWithTag("api-section-Events").performClick()
    workspaceChoose(ui, "api-event-selector", id, id)
    return ui.onNodeWithTag("api-event-$id")
}

internal fun workspaceAppliedCode(ui: WorkspaceRule, overrides: Boolean = false): SemanticsNodeInteraction {
    workspaceCloseDialog(ui)
    ui.onNodeWithTag("workspace-code").performClick()
    workspaceChoose(ui, "configuration-code-section", if (overrides) "SDK overrides" else "Player, source and UI")
    return ui.onNodeWithTag(if (overrides) "api-settings-code" else "configuration-code-text")
}

internal fun workspaceOfflineCode(ui: WorkspaceRule, factory: Boolean = false): SemanticsNodeInteraction {
    workspaceMore(ui, "Offline")
    workspaceChoose(ui, "offline-page", "Code")
    return ui.onNodeWithTag(if (factory) "offline-factory-code" else "offline-config-code")
}

internal fun workspaceClick(ui: WorkspaceRule, tag: String) {
    if (tag.startsWith("record-")) {
        val target = workspaceRecordTarget(ui, tag) ?: return
        ui.onNodeWithTag(target).assertIsDisplayed().performClick()
        return
    }
    workspaceCloseRecordEditors(ui)
    workspaceCloseDialog(ui)
    when {
        tag == "configuration-toggle" -> { ui.onNodeWithTag("workspace-settings").performClick(); workspaceChoose(ui, "settings-page", "Source"); return }
        tag == "configuration-code-toggle" -> { workspaceAppliedCode(ui); return }
        tag == "api-settings-toggle" -> { ui.onNodeWithTag("workspace-settings").performClick(); workspaceChoose(ui, "settings-page", "SDK overrides"); return }
        tag == "api-runtime-toggle" -> { ui.onNodeWithTag("workspace-apis").performClick(); return }
        tag == "offline-toggle" -> { workspaceMore(ui, "Offline"); return }
        tag == "analytics-toggle" -> { workspaceMore(ui, "Analytics"); return }
        tag == "api-callback-refresh" -> workspaceMore(ui, "Diagnostics")
        tag.startsWith("api-startup-") -> workspaceMore(ui, "Startup and integrations")
        tag == "allow-dvr" -> workspaceMore(ui, "Playback options")
        tag == "live-edge" -> workspaceMore(ui, "Live controls")
        tag.startsWith("api-select-") -> { workspaceSdkSetting(ui, tag.removePrefix("api-select-")); return }
        tag in listOf("api-settings-apply", "api-settings-reset") -> {
            ui.onNodeWithTag("workspace-settings").performClick(); workspaceChoose(ui, "settings-page", "SDK overrides")
        }
        tag.startsWith("api-command-") && tag != "api-command-run" -> { workspaceCommand(ui, tag.removePrefix("api-command-")); return }
        tag.startsWith("source-type-") -> { workspaceSetting(ui, "source-type"); workspaceChoose(ui, "source-type", tag.removePrefix("source-type-")); return }
        tag.startsWith("source-reference-") -> { workspaceSetting(ui, "source-reference"); workspaceChoose(ui, "source-reference", tag.removePrefix("source-reference-").takeUnless { it == "SDK default" } ?: "null"); return }
        configurationItems.any { it.id == tag } -> workspaceSetting(ui, tag)
        tag in listOf("apply-source", "reset-source") -> { ui.onNodeWithTag("workspace-settings").performClick(); workspaceChoose(ui, "settings-page", "Source") }
        tag in listOf("apply-player", "reset-player") -> { ui.onNodeWithTag("workspace-settings").performClick(); workspaceChoose(ui, "settings-page", "Player") }
        tag == "offline-factory-toggle" -> { navigateOffline(ui, "offline-factory-drm"); return }
        tag.contains("-select-") && tag.startsWith("analytics-") -> { navigateAnalytics(ui, tag); return }
        tag.endsWith("-toggle") && tag.startsWith("analytics-") -> { navigateAnalytics(ui, tag); return }
        tag.startsWith("offline-") -> navigateOffline(ui, tag)
        tag.startsWith("analytics-") -> navigateAnalytics(ui, tag)
    }
    val target = ui.onNodeWithTag(tag)
    if (runCatching { target.assertIsDisplayed() }.isFailure) target.performScrollTo()
    target.assertIsDisplayed().performClick()
}

internal fun workspaceField(ui: WorkspaceRule, tag: String, value: String) {
    if (tag.startsWith("record-")) {
        val target = requireNotNull(workspaceRecordTarget(ui, tag))
        ui.onNodeWithTag(target).assertIsDisplayed().performTextReplacement(value)
        closeSoftKeyboard()
        return
    }
    when {
        tag == "api-settings-search" -> {
            workspaceClick(ui, "api-settings-toggle")
            workspaceChoose(ui, "api-settings-category", "All features")
            ui.onNodeWithTag("api-settings-field").performClick()
            ui.onNodeWithTag("api-settings-field-search").performTextReplacement(value)
            workspaceCloseDialog(ui); return
        }
        tag == "api-runtime-search" -> {
            workspaceCloseDialog(ui)
            val state = ui.onNodeWithTag("api-section-State").fetchSemanticsNode().config.getOrElse(SemanticsProperties.Selected) { false }
            val events = ui.onNodeWithTag("api-section-Events").fetchSemanticsNode().config.getOrElse(SemanticsProperties.Selected) { false }
            val selector = when { state -> "api-state-selector"; events -> "api-event-selector"; else -> "api-command-selector" }
            if (!state && !events) workspaceChoose(ui, "api-command-category", "All features")
            ui.onNodeWithTag(selector).performClick()
            ui.onNodeWithTag("$selector-search").performTextReplacement(value)
            // State/event readers are explicit selections. Commands remain unchanged until selected.
            val selected = when {
                state -> ApiRuntime.reads.firstOrNull { it.id.contains(value, true) }?.id
                events -> (ApiEvents.player.map { it.id } + ApiEvents.source.map { it.id }).firstOrNull { it.contains(value, true) }
                else -> null
            }
            if (selected != null) {
                ui.onNodeWithTag("$selector-options").performScrollToNode(hasTestTag("$selector-option-$selected"))
                ui.onNodeWithTag("$selector-option-$selected").performClick()
            } else workspaceCloseDialog(ui)
            return
        }
        tag.startsWith("api-argument-") -> workspaceChoose(ui, "api-argument-selector", tag.removePrefix("api-argument-"))
        tag == "api-setting-value" -> ui.onNodeWithTag("api-settings-field").assertIsDisplayed()
        tag == "offline-options-search" -> {
            workspaceMore(ui, "Offline"); workspaceChoose(ui, "offline-page", "Track selection")
            workspaceChoose(ui, "offline-track-selector", value, value); return
        }
        tag.endsWith("-search") && tag.startsWith("analytics-") -> {
            navigateAnalytics(ui, tag)
            val prefix = tag.removeSuffix("-search")
            ui.onNodeWithTag("$prefix-field").performClick()
            ui.onNodeWithTag("$prefix-field-search").performTextReplacement(value)
            workspaceCloseDialog(ui); return
        }
        configurationItems.any { it.id == tag } -> workspaceSetting(ui, tag)
        tag.startsWith("offline-") -> navigateOffline(ui, tag)
        tag.startsWith("analytics-") -> navigateAnalytics(ui, tag)
    }
    ui.waitUntil(5_000) {
        ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() ||
            tag == "api-setting-value" && ui.onAllNodesWithTag("api-choice-$value").fetchSemanticsNodes().isNotEmpty()
    }
    if (tag == "api-setting-value" && ui.onAllNodesWithTag("api-choice-$value").fetchSemanticsNodes().isNotEmpty()) {
        ui.onNodeWithTag("api-choice-$value").assertIsDisplayed().performClick()
    } else ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed().performTextReplacement(value)
    closeSoftKeyboard()
}

private fun workspaceCloseRecordEditors(ui: WorkspaceRule) {
    while (ui.onAllNodesWithText("Close editor").fetchSemanticsNodes().isNotEmpty()) {
        ui.onAllNodesWithText("Close editor").onLast().performClick()
    }
}

/** Chooses an item and property in the real structured-value editor, including nested lists. */
private fun workspaceRecordTarget(ui: WorkspaceRule, tag: String): String? {
    workspaceCloseDialog(ui)
    workspaceCloseRecordEditors(ui)
    ui.onNodeWithTag("record-open").assertIsDisplayed().performClick()
    val parts = tag.split('-')
    var path = "record"
    var cursor = 1
    while (cursor < parts.size) {
        if (parts[cursor] == "add") return "$path-add"
        val index = parts[cursor].toInt()
        workspaceChoose(ui, "$path-item", index.toString())
        val property = parts[cursor + 1]
        if (property == "remove") return "$path-$index-remove"
        workspaceChoose(ui, "$path-property", property, property)
        val field = "$path-$index-$property"
        cursor += 2
        if (cursor == parts.size) return field
        if (parts[cursor] == "toggle") return "$field-toggle"
        if (parts[cursor] == "add" || parts[cursor].toIntOrNull() != null) {
            ui.onNodeWithTag("$field-toggle").assertIsDisplayed().performClick()
            path = field
        } else {
            workspaceChoose(ui, "$field-choice", parts.drop(cursor).joinToString("-"))
            return null
        }
    }
    error("Unsupported record editor path")
}

private fun workspaceCloseDialog(ui: WorkspaceRule) {
    if (ui.onAllNodesWithText("Close").fetchSemanticsNodes().isNotEmpty()) ui.onNodeWithText("Close").performClick()
}

private fun navigateOffline(ui: WorkspaceRule, tag: String) {
    workspaceMore(ui, "Offline")
    val page = when {
        tag == "offline-options" -> "Actions"
        tag.startsWith("offline-factory") -> "Offline source"
        tag.startsWith("offline-config") && tag != "offline-config-read" -> "Download settings"
        tag.startsWith("offline-action-") || tag.startsWith("offline-option") || tag == "offline-process" -> "Track selection"
        tag in listOf("offline-content-id", "offline-create", "offline-use-sample") -> "Manager"
        else -> "Actions"
    }
    workspaceChoose(ui, "offline-page", page)
    if (page == "Download settings") {
        val setting = when (tag) { "offline-config-segments" -> "Segments"; "offline-config-automatic-drm" -> "DRM license handling"; else -> "Downloads" }
        workspaceChoose(ui, "offline-setting", setting)
    }
    if (page == "Offline source") {
        val setting = when (tag) { "offline-factory-cache" -> "Cache directory"; "offline-factory-tracks" -> "Track-state file"; "offline-factory-restrict" -> "Offline restriction"; else -> "DRM ID" }
        workspaceChoose(ui, "offline-factory-setting", setting)
    }
    if (page == "Actions") workspaceChoose(ui, "offline-action-selector", tag)
}

/** Routes real input through the owned app window rather than a detached DOM or View. */
internal fun workspaceTapVisiblePlayer(ui: WorkspaceRule, view: View, fractionX: Float = .15f, fractionY: Float = .25f) =
    workspaceTouchVisiblePlayer(ui, view, fractionX, fractionY, fractionY)

internal fun workspaceSwipeVisiblePlayer(ui: WorkspaceRule, view: View, fractionX: Float, fromY: Float, toY: Float) =
    workspaceTouchVisiblePlayer(ui, view, fractionX, fromY, toY)

private fun workspaceTouchVisiblePlayer(ui: WorkspaceRule, view: View, fractionX: Float, fractionY: Float, toFractionY: Float) {
    var x = 0f
    var y = 0f
    var endY = 0f
    ui.runOnUiThread {
        val visible = Rect()
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        x = location[0] + view.width * fractionX
        y = location[1] + view.height * fractionY
        endY = location[1] + view.height * toFractionY
        assertTrue("Reveal touch must be inside the current visible player", view.isAttachedToWindow && view.isShown &&
            view.getGlobalVisibleRect(visible) && visible.contains(x.toInt(), y.toInt()) && visible.contains(x.toInt(), endY.toInt()))
    }
    val down = SystemClock.uptimeMillis()
    val handled = ConcurrentHashMap<Int, Boolean>()
    lateinit var previous: Window.Callback
    lateinit var observer: Window.Callback
    ui.runOnUiThread {
        previous = ui.activity.window.callback
        observer = object : Window.Callback by previous {
            override fun dispatchTouchEvent(event: MotionEvent): Boolean {
                val consumed = previous.dispatchTouchEvent(event)
                if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_UP) handled[event.actionMasked] = consumed
                return consumed
            }
        }
        ui.activity.window.callback = observer
    }
    try {
        val steps = if (y == endY) listOf(MotionEvent.ACTION_DOWN to y, MotionEvent.ACTION_UP to y) else
            listOf(MotionEvent.ACTION_DOWN to y) + (1..8).map { MotionEvent.ACTION_MOVE to (y + (endY - y) * it / 8) } +
                listOf(MotionEvent.ACTION_UP to endY)
        for ((action, atY) in steps) {
            if (action == MotionEvent.ACTION_MOVE) SystemClock.sleep(20)
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, atY, 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            try { assertTrue("The owned app window must accept native touch input", InstrumentationRegistry.getInstrumentation().uiAutomation.injectInputEvent(event, true)) }
            finally { event.recycle() }
        }
        ui.waitUntil(5_000) { handled.keys.containsAll(listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) }
        assertTrue("Native player touch down must be consumed", handled[MotionEvent.ACTION_DOWN] == true)
        assertTrue("Native player touch up must be consumed", handled[MotionEvent.ACTION_UP] == true)
    } finally {
        ui.runOnUiThread { if (ui.activity.window.callback === observer) ui.activity.window.callback = previous }
    }
}

private fun navigateAnalytics(ui: WorkspaceRule, tag: String) {
    workspaceMore(ui, "Analytics")
    val page = when {
        tag.startsWith("analytics-default") -> "Default metadata"
        tag.startsWith("analytics-source-") && tag != "analytics-source-custom" -> "Source metadata"
        tag.startsWith("analytics-custom-") && tag != "analytics-custom-event" -> "Runtime custom data"
        tag.startsWith("analytics-error") -> "Errors"
        tag == "analytics-random-user" -> "Identity"
        tag in listOf("analytics-state", "analytics-custom-event", "analytics-source-custom", "analytics-program-change") -> "Runtime actions"
        else -> "Collection"
    }
    workspaceChoose(ui, "analytics-page", page)
    if (tag.contains("-select-")) {
        val (prefix, field) = tag.split("-select-", limit = 2)
        workspaceChoose(ui, "$prefix-field", field, field)
    }
    if (page == "Runtime actions") workspaceChoose(ui, "analytics-action-selector", tag)
}
