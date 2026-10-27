package com.playerlab.android

import android.content.Context
import android.view.inputmethod.InputMethodManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.platform.LocalView
import com.bitmovin.player.PlayerView

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PlayerWorkspace(controller: PlayerController) {
    val television = workspaceTelevision()
    var uiMode by remember { mutableStateOf(UiMode.DEFAULT) }
    var selectedPreset by remember { mutableStateOf(Sources.all.firstOrNull()?.id.orEmpty()) }
    var tab by remember { mutableStateOf(WorkspaceTab.Settings) }
    var settingsPage by remember { mutableStateOf("Source") }
    val configuration = remember { ConfigurationWorkspaceState(controller.sourceSettings, controller.playerSettings) }
    val overrides = remember { ApiConfigurationWorkspaceState(controller.apiOverrides) }
    val runtime = remember { ApiRuntimeWorkspaceState() }
    val focus = LocalFocusManager.current
    val sourceFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    DisposableEffect(controller, focus, sourceFocus) {
        controller.apiClearFocus = { focus.clearFocus(force = true) }
        controller.requestWorkspaceFocus = { focus.clearFocus(force = true); sourceFocus.requestFocus() }
        onDispose { controller.apiClearFocus = {}; controller.requestWorkspaceFocus = {} }
    }
    val videoOnly = controller.apiFullscreen || controller.apiPictureInPicture
    val keyboardInset = workspaceKeyboardEditing()
    val keyboardVisible = keyboardInset || (television && WindowInsets.isImeVisible)
    val workspaceView = LocalView.current
    var selectionEpoch by remember { mutableIntStateOf(0) }
    var keyboardWasVisible by remember { mutableStateOf(false) }
    var keyboardScope by remember { mutableStateOf<List<Any?>?>(null) }
    var keyboardDoneScope by remember { mutableStateOf<List<Any?>?>(null) }
    val editorScope = listOf(tab, settingsPage, configuration.selected, overrides.selected,
        runtime.section, runtime.selected, runtime.argument, runtime.stateSelected, runtime.eventSelected,
        uiMode, selectionEpoch, controller.apiPlayerGeneration, controller.sourceRevision, controller.apiViewRevision)
    val completeKeyboardEditing: () -> Unit = { keyboardDoneScope = editorScope; keyboard?.hide() }
    LaunchedEffect(keyboardVisible, editorScope, television, videoOnly) {
        if (keyboardVisible) {
            if (!keyboardWasVisible) keyboardScope = editorScope.takeIf {
                television && !videoOnly && workspaceView.hasWindowFocus() && controller.currentView()?.hasFocus() != true
            }
            keyboardWasVisible = true
        } else {
            keyboardWasVisible = false
            val done = keyboardDoneScope != null
            val recorded = keyboardDoneScope ?: keyboardScope
            keyboardScope = null
            keyboardDoneScope = null
            if (television && !videoOnly && recorded != null && recorded == editorScope) {
                val owner = controller.player
                val source = owner.source
                val view = controller.currentView()
                // Wait for selectors to be placed again; a scope change cancels this effect.
                withFrameNanos { }
                if (workspaceView.hasWindowFocus() && !controller.apiFullscreen && !controller.apiPictureInPicture &&
                    controller.player === owner && !owner.isDestroyed && owner.source === source &&
                    controller.currentView() === view && view?.hasFocus() != true) {
                    val input = workspaceView.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                    if (done) controller.requestWorkspaceFocus()
                    else if (input.isAcceptingText && !focus.moveFocus(FocusDirection.Previous)) controller.requestWorkspaceFocus()
                }
            }
        }
    }
    androidx.activity.compose.BackHandler(enabled = controller.apiFullscreen) { controller.currentView()?.exitFullscreen() }
    BoxWithConstraints(Modifier.fillMaxSize().then(if (videoOnly) Modifier else Modifier.safeDrawingPadding().imePadding())
        .then(if (television && !videoOnly) Modifier.padding(horizontal = 48.dp, vertical = 27.dp) else Modifier)
        .clipToBounds().testTag("player-workspace")) {
        val wide = !videoOnly && maxWidth >= 600.dp && maxWidth > maxHeight
        val compact = maxHeight < 600.dp
        val previewHeight = if (keyboardVisible || LocalDensity.current.fontScale >= 1.3f) 64.dp
            else if (compact) 88.dp else minOf(200.dp, maxWidth * 9 / 16)
        val previewPixels = with(LocalDensity.current) { previewHeight.roundToPx() }
        val playerContent: @Composable (Modifier) -> Unit = { modifier ->
            PlayerPreview(controller, uiMode, television, modifier.testTag("player-preview"))
        }
        val selectors: @Composable () -> Unit = {
            SourceAndTheme(controller, selectedPreset, uiMode, sourceFocus, { uiMode = it }, {
                    configuration.select("source-url"); settingsPage = "Source"; tab = WorkspaceTab.Settings; focus.clearFocus()
                }, { preset ->
                    selectedPreset = preset.id
                    controller.load(preset)
                    configuration.source = SourceDraft.from(controller.sourceSettings)
                    configuration.sourceBase = controller.sourceSettings
                    configuration.sourceErrors = emptyMap()
                    configuration.message = ""
                })
        }
        val editorContent: @Composable (Modifier) -> Unit = { modifier ->
            Column(modifier) {
                WorkspaceNavigation(tab) { tab = it; focus.clearFocus() }
                if (keyboardVisible) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    UiText("Editing", style = MaterialTheme.typography.labelMedium)
                    TextButton(onClick = {
                        if (television) completeKeyboardEditing() else { focus.clearFocus(); keyboard?.hide() }
                    }, modifier = Modifier.testTag("workspace-done")) { UiText("Done") }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    RetainedWorkspacePage(tab == WorkspaceTab.Settings) {
                        Column(Modifier.fillMaxSize()) {
                            WorkspaceHeader(!keyboardVisible) { WorkspacePicker("Configuration", if (settingsPage == "SDK overrides") settingsPage else configuration.group,
                                listOf("Source", "Player", "SDK overrides").map { it to it },
                                "settings-page", compact = true, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                                settingsPage = it
                                if (it != "SDK overrides") { configuration.group = it; configuration.selected = configurationItems.first { item -> item.group == it }.id }
                                focus.clearFocus()
                            } }
                            Box(Modifier.weight(1f)) {
                                RetainedWorkspacePage(settingsPage != "SDK overrides") { ConfigurationPanel(controller, configuration) }
                                RetainedWorkspacePage(settingsPage == "SDK overrides") { ApiConfigurationPanel(controller, overrides) }
                            }
                        }
                    }
                    RetainedWorkspacePage(tab == WorkspaceTab.APIs) { ApiRuntimePanel(controller, runtime, uiMode) }
                    RetainedWorkspacePage(tab == WorkspaceTab.Code) { ConfigurationCodeView(controller, uiMode) }
                    RetainedWorkspacePage(tab == WorkspaceTab.More, composeInitially = true) { MoreWorkspace(controller) }
                }
            }
        }
        // Presentation changes only move/resize these stable children. Replacing the AndroidView
        // would retire its SDK fullscreen/PiP handlers while their transition is still in progress.
        Layout(content = {
            CompositionLocalProvider(LocalWorkspaceSelectionChanged provides { if (television) selectionEpoch++ },
                LocalWorkspaceImeDone provides { fieldView ->
                    if (television && keyboardVisible && !videoOnly && fieldView.rootView === workspaceView.rootView &&
                        workspaceView.hasWindowFocus() && controller.currentView()?.hasFocus() != true) {
                        completeKeyboardEditing()
                        true
                    } else false
                }) {
                playerContent(Modifier.fillMaxSize())
                editorContent(Modifier.fillMaxSize())
                selectors()
            }
        }, modifier = Modifier.fillMaxSize()) { children, constraints ->
            val width = constraints.maxWidth
            val height = constraints.maxHeight
            val playerWidth = if (wide) (width * 0.46f).toInt() else width
            val playerHeight = when {
                videoOnly -> height
                wide -> minOf(height, playerWidth * 9 / 16)
                else -> minOf(height, previewPixels)
            }
            val player = children[0].measure(Constraints.fixed(playerWidth, playerHeight))
            val selector = if (videoOnly || keyboardVisible) null else children[2].measure(Constraints(
                minWidth = playerWidth, maxWidth = playerWidth, maxHeight = height))
            val selectorHeight = selector?.height ?: 0
            val editor = if (videoOnly) null else children[1].measure(Constraints.fixed(
                if (wide) width - playerWidth else width,
                if (wide) height else (height - playerHeight - selectorHeight).coerceAtLeast(0)))
            layout(width, height) {
                val playerTop = if (wide) ((height - playerHeight - selectorHeight) / 2).coerceAtLeast(0) else 0
                player.placeRelative(0, playerTop)
                selector?.placeRelative(0, playerTop + playerHeight)
                editor?.placeRelative(if (wide) playerWidth else 0, if (wide) 0 else playerHeight + selectorHeight)
            }
        }
    }
}

@Composable
private fun PlayerPreview(controller: PlayerController, uiMode: UiMode, television: Boolean, modifier: Modifier) {
    val displayedPlayer = controller.player
    val vrRenderer = controller.apiVrRenderer
    if (vrRenderer != null) key(vrRenderer) {
        AndroidView(factory = { vrRenderer }, onRelease = { it.close() }, modifier = modifier)
    } else key(displayedPlayer, uiMode, television, controller.apiViewRevision) {
        AndroidView(factory = { context ->
            PlayerTouchHost(context, controller.attachView(PlayerView(context, displayedPlayer,
                liveRewindViewConfig(controller.apiOverrides.view(playerViewConfig(uiMode, television)), controller.timeShiftEnabled))))
        }, onRelease = { host ->
            host.releaseTouchOwnership()
            controller.releaseView(host.content as PlayerView)
        }, modifier = modifier)
    }
}

@Composable
private fun SourceAndTheme(controller: PlayerController, selectedPreset: String, mode: UiMode, sourceFocus: FocusRequester, changeMode: (UiMode) -> Unit, customSource: () -> Unit, loadPreset: (PlayerSource) -> Unit) {
    val sourceId = Sources.all.firstOrNull { it.id == selectedPreset && it.url == controller.sourceSettings.url && it.type == controller.sourceSettings.type }?.id
        ?: Sources.all.firstOrNull { it.url == controller.sourceSettings.url && it.type == controller.sourceSettings.type }?.id ?: "custom"
    Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        WorkspacePicker("Source", sourceId, Sources.all.map { it.id to it.label } + listOf("custom" to "Custom stream"),
            "source-selector", compact = true, modifier = Modifier.weight(1f).focusRequester(sourceFocus)) { id ->
                if (id == "custom") customSource() else Sources.all.firstOrNull { it.id == id }?.let(loadPreset)
            }
        WorkspacePicker("Theme", mode, UiMode.entries.map { it to it.label }, "theme-selector", compact = true, modifier = Modifier.weight(1f), change = changeMode)
    }
}

@Composable
private fun PlaybackSummary(controller: PlayerController) {
    UiText(uiFormat(R.string.ui_current_playback,
        uiText(if (controller.player.isPlaying) "playing" else if (controller.player.isPaused) "paused" else "not playing"),
        controller.configuredSource?.loadingState?.toString() ?: uiText("None"),
        controller.lastErrorCode?.let { uiFormat(R.string.ui_sdk_error, it) } ?: ""),
        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(12.dp).testTag("playback-summary"))
}

@Composable
private fun MoreWorkspace(controller: PlayerController) {
    var page by remember { mutableStateOf("Playback options") }
    val pages = listOf("Playback options", "Live controls", "Offline", "Analytics", "Startup and integrations", "Diagnostics")
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(!workspaceKeyboardEditing()) {
            WorkspacePicker("More", page, pages.map { it to it }, "more-page", compact = true,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) { page = it }
        }
        Box(Modifier.weight(1f)) {
            RetainedWorkspacePage(page == "Playback options") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ConfigToggle("Enable live rewind controls", controller.timeShiftEnabled, "allow-dvr", controller::toggleDvr)
                    UiText("Requires a live window and SDK time shifting.", style = MaterialTheme.typography.bodySmall)
                    WorkspaceHeading("Current playback")
                    PlaybackSummary(controller)
                    UiText(uiFormat(R.string.ui_source_type, controller.sourceSettings.type.toString()))
                    UiText(uiFormat(R.string.ui_title, controller.sourceSettings.title.ifBlank { uiText("Not set") }))
                    UiText(uiFormat(R.string.ui_current_settings, controller.playerSettings.autoplay.toString(), controller.playerSettings.muted.toString()))
                }
            }
            RetainedWorkspacePage(page == "Live controls") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    WorkspaceHeading("Live playback", "These controls are available only for a live source.")
                    val preset = Sources.all.firstOrNull { it.url == controller.sourceSettings.url }
                    val currentSourceReady = controller.player.source === controller.configuredSource &&
                        controller.configuredSource?.loadingState == com.bitmovin.player.api.source.LoadingState.Loaded
                    if (controller.dvr.isLive && preset?.isLive != false && currentSourceReady) {
                        Button(onClick = controller::goToLiveEdge, modifier = Modifier.testTag("live-edge")) { UiText("Live edge") }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf(-10.0, -30.0, -60.0).forEach { offset ->
                                OutlinedButton(onClick = { controller.seek(offset) }, enabled = controller.dvr.dvrAvailable,
                                    modifier = Modifier.weight(1f).testTag("live-rewind-${offset.toInt()}")) { UiText("${offset.toInt()}s") }
                            }
                        }
                        if (!controller.dvr.dvrAvailable) UiText("Rewind is unavailable for this source or its current configuration.", style = MaterialTheme.typography.bodySmall)
                    } else UiText(if (preset?.isLive == false || currentSourceReady && !controller.dvr.isLive)
                        "VOD source. Live controls unavailable."
                        else "Load a live source to use these controls.", style = MaterialTheme.typography.bodyMedium)
                }
            }
            RetainedWorkspacePage(page == "Offline") { ApiOfflinePanel(controller) }
            RetainedWorkspacePage(page == "Analytics") { ApiAnalyticsPanel(controller) }
            // SDK companion containers must stay attached even before this destination is opened.
            RetainedWorkspacePage(page == "Startup and integrations", composeInitially = true) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ApiStartupPanel(controller)
                    controller.apiCompanionHosts.forEach { host -> key(host.view) {
                        WorkspaceHeading(uiFormat(R.string.ui_companion, host.name))
                        AndroidView(factory = { host.view }, onRelease = { (it.parent as? android.view.ViewGroup)?.removeView(it) },
                            modifier = if (host.width == -1) Modifier.fillMaxWidth().heightIn(min = 50.dp, max = 500.dp)
                            else Modifier.width(host.width.dp).height(host.height.dp))
                    } }
                }
            }
            RetainedWorkspacePage(page == "Diagnostics") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PlaybackSummary(controller)
                    UiText("mode=${controller.dvr.mode.raw}; rewind available=${controller.dvr.dvrAvailable}; behind live=${"%.1f".format(controller.dvr.behindLive)} s; window=${"%.0f".format(controller.dvr.windowDuration)} s", style = MaterialTheme.typography.bodySmall)
                    controller.log.take(12).forEach { UiText(it, style = MaterialTheme.typography.bodySmall) }
                    ApiCallbackOutcomes(controller)
                }
            }
        }
    }
}
