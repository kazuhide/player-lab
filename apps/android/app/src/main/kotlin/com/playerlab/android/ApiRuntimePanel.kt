package com.playerlab.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

internal class ApiRuntimeOwnerIdentity(private val owner: Any?) {
    override fun equals(other: Any?) = other is ApiRuntimeOwnerIdentity && owner === other.owner
    override fun hashCode() = System.identityHashCode(owner)
}

internal data class ApiRuntimeContext(
    val playerGeneration: Int,
    val sourceRevision: Int,
    val source: ApiRuntimeOwnerIdentity,
    val viewRevision: Int,
    val vrRenderer: ApiRuntimeOwnerIdentity,
    val uiMode: UiMode,
)

private data class ApiRuntimeSourceContext(val playerGeneration: Int, val sourceRevision: Int, val source: ApiRuntimeOwnerIdentity)
private fun ApiRuntimeContext.sourceContext() = ApiRuntimeSourceContext(playerGeneration, sourceRevision, source)

private fun runtimeContext(controller: PlayerController, uiMode: UiMode) = ApiRuntimeContext(
    controller.apiPlayerGeneration, controller.sourceRevision, ApiRuntimeOwnerIdentity(controller.configuredSource),
    controller.apiViewRevision, ApiRuntimeOwnerIdentity(controller.apiVrRenderer), uiMode,
)

internal class ApiRuntimeWorkspaceState {
    var section by mutableStateOf("Commands")
    var selected by mutableStateOf(ApiRuntime.commands.first().id)
    var purpose by mutableStateOf(apiPurpose(selected))
    var commandArguments by mutableStateOf(emptyMap<String, Map<String, String>>())
    var argument by mutableStateOf("")
    var result by mutableStateOf("")
    var resultContext: ApiRuntimeContext? = null
    var observed by mutableStateOf("")
    var observations by mutableStateOf(emptyMap<String, String>())
    var stateSelected by mutableStateOf(ApiRuntime.reads.first().id)
    var eventSelected by mutableStateOf(ApiEvents.player.first().id)
    var dispatchRevision by mutableIntStateOf(0)
        private set
    fun commandDispatched() { dispatchRevision++ }
    private var manualSsaiContext by mutableStateOf<ApiRuntimeSourceContext?>(null)
    fun manualSsaiEnabled(context: ApiRuntimeContext) = manualSsaiContext == context.sourceContext()
    fun setManualSsaiEnabled(enabled: Boolean, context: ApiRuntimeContext) {
        manualSsaiContext = if (enabled) context.sourceContext() else null
    }
    fun invalidateFor(context: ApiRuntimeContext) {
        if (!manualSsaiEnabled(context)) manualSsaiContext = null
        if (resultContext != context) { result = ""; resultContext = null }
        observed = ""
        observations = emptyMap()
    }
    val selectedMatchesFeature: Boolean get() = purpose == "All features" || apiPurpose(selected) == purpose
    fun filterByPurpose(purpose: String) { this.purpose = purpose }
    fun select(id: String) { selected = id; purpose = apiPurpose(id); argument = ""; result = ""; resultContext = null; observed = "" }
    fun arguments(command: ApiCommand) = commandArguments[command.id] ?: command.arguments.associate { it.name to it.example }
    fun setArgument(command: ApiCommand, name: String, value: String) {
        commandArguments = commandArguments + (command.id to (arguments(command) + (name to value)))
    }
}

@Composable
internal fun ApiRuntimePanel(controller: PlayerController, state: ApiRuntimeWorkspaceState, uiMode: UiMode = UiMode.DEFAULT) {
    val focus = LocalFocusManager.current
    val keyboardVisible = workspaceKeyboardEditing()
    val command = ApiRuntime.commands.first { it.id == state.selected }
    val context = runtimeContext(controller, uiMode)
    val capabilities = rememberApiCommandCapabilities(controller, context, state.dispatchRevision)
    val manualSsai = state.manualSsaiEnabled(context)
    val unavailableReason = apiCommandUnavailableReason(command.id, capabilities, manualSsai, state.arguments(command))
    LaunchedEffect(context) {
        // A synchronous command can replace its own view or source. Keep only its
        // receipt for that resulting context; unrelated ownership changes retire it.
        state.invalidateFor(context)
    }
    Column(Modifier.fillMaxSize().testTag("api-runtime-panel")) {
        WorkspaceHeader(!keyboardVisible) { Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WorkspaceSections(listOf("Commands", "State", "Events"), state.section, "api-section") { state.section = it; focus.clearFocus() }
            when (state.section) {
                "Commands" -> {
                    val purposes = listOf("All features") + ApiRuntime.commands.map { apiPurpose(it.id) }.distinct().sorted()
                    WorkspacePicker("Feature", state.purpose, purposes.map { it to it }, "api-command-category", compact = true) { purpose ->
                        state.filterByPurpose(purpose)
                        focus.clearFocus()
                    }
                    WorkspacePicker("Operation", state.selected, ApiRuntime.commands.filter { state.purpose == "All features" || apiPurpose(it.id) == state.purpose }.map { it.id to it.label },
                        "api-command-selector", searchable = true, compact = true, selectedLabel = command.label,
                        unavailableReason = { apiCommandUnavailableReason(it, capabilities, manualSsai) }) { state.select(it); focus.clearFocus() }
                }
                "State" -> WorkspacePicker("SDK state", state.stateSelected, ApiRuntime.reads.map { it.id to apiDisplayName(it.id) },
                    "api-state-selector", searchable = true) { state.stateSelected = it; focus.clearFocus() }
                "Events" -> WorkspacePicker("SDK event", state.eventSelected, allEventIds.map { it to it },
                    "api-event-selector", searchable = true) { state.eventSelected = it; focus.clearFocus() }
            }
        } }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (state.section) {
                "Commands" -> {
                    if (state.purpose == "Advertising" || command.id == "app:ssai-ad" || ".ssai." in command.id) {
                        ConfigToggle("Manual SSAI integration", manualSsai, "api-manual-ssai") {
                            state.setManualSsaiEnabled(it, context)
                            state.result = ""
                            state.resultContext = null
                        }
                        UiText("Metadata only; does not insert ad media.", style = MaterialTheme.typography.bodySmall)
                    }
                    if (command.arguments.isEmpty()) UiText("No arguments.", style = MaterialTheme.typography.bodyMedium)
                    else {
                        val selectedArgument = command.arguments.firstOrNull { it.name == state.argument } ?: command.arguments.first()
                        WorkspacePicker("Argument", selectedArgument.name, command.arguments.map { it.name to it.name }, "api-argument-selector", compact = true) { state.argument = it; focus.clearFocus() }
                        OutlinedTextField(state.arguments(command)[selectedArgument.name].orEmpty(), { state.setArgument(command, selectedArgument.name, it) },
                            label = { UiText(selectedArgument.name) },
                            textStyle = if (selectedArgument.multiline) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodyLarge,
                            singleLine = !selectedArgument.multiline, maxLines = if (selectedArgument.multiline) 4 else 1,
                            modifier = Modifier.fillMaxWidth().testTag("api-argument-${selectedArgument.name}"))
                        if (selectedArgument.choices.isNotEmpty()) Choices(selectedArgument.choices.map { it to it }, state.arguments(command)[selectedArgument.name].orEmpty(), "api-argument-choice") {
                            state.setArgument(command, selectedArgument.name, it)
                        }
                    }
                    ApiCommandNotes(command)
                    if (state.result.isNotEmpty()) {
                        WorkspaceReadout("Call result", state.result, "api-command-result")
                    }
                    if (controller.apiAsyncResult.isNotEmpty()) Text(controller.apiAsyncResult, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-async-result"))
                    if (state.observed.isEmpty()) UiText("Refresh to read playback state.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-related-state"))
                    else WorkspaceReadout("Observed playback state", state.observed, "api-related-state")
                    OutlinedButton(onClick = { state.observed = observedPlayback(controller) }, modifier = Modifier.testTag("api-related-state-refresh")) { UiText("Refresh playback state") }
                    WorkspaceHeading("Recent SDK events", "This app session")
                    RecentApiEvents(controller)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { state.section = "State" }, modifier = Modifier.testTag("api-related-state-open")) { UiText("All SDK state") }
                        TextButton(onClick = { state.section = "Events" }, modifier = Modifier.testTag("api-related-events-open")) { UiText("All SDK events") }
                    }
                    if (command.id.contains("CustomMessage") || command.id == "app:custom-message-send") {
                        UiText("The host endpoint is playerLabMessage(data: String). A custom Web UI must register its incoming message handler. Only this session's latest messages are shown.", style = MaterialTheme.typography.bodySmall)
                        controller.apiHostMessages.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                }
                "State" -> {
                    val observation = state.observations[state.stateSelected]
                    if (observation == null) UiText("Not read yet", style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.testTag("api-state-${state.stateSelected}"))
                    else WorkspaceReadout("Value at last refresh", observation, "api-state-${state.stateSelected}")
                    if (state.stateSelected.contains("Vector3")) UiText("Last moveViewingDirection input", style = MaterialTheme.typography.bodySmall)
                    else if ((state.stateSelected.contains(".advertising.") && !state.stateSelected.contains(".AdvertisingApi.")) ||
                        state.stateSelected.contains(".ssai.SsaiAd"))
                        UiText("Requires an active ad or selected SSAI object.", style = MaterialTheme.typography.bodySmall)
                }
                "Events" -> {
                    ConfigToggle("Record SDK events", controller.apiEventRecording, "api-event-recording") { controller.apiEventRecording = it }
                    val id = state.eventSelected
                    WorkspaceReadout("This app session", uiFormat(R.string.ui_event_readout, id, controller.apiEvents[id] ?: 0,
                        controller.apiEventTimes[id]?.toString() ?: uiText("Not read yet")), "api-event-$id")
                    WorkspaceHeading("Recent SDK events")
                    RecentApiEvents(controller)
                }
            }
        }
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                when (state.section) {
                    "Commands" -> {
                        UiText(uiFormat(R.string.ui_run_target, uiText(command.label)), style = MaterialTheme.typography.labelMedium, maxLines = 2,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.testTag("api-run-target"))
                        if (!state.selectedMatchesFeature) UiText(uiFormat(R.string.ui_choose_operation, uiText(state.purpose)),
                            style = MaterialTheme.typography.labelSmall, maxLines = 2, modifier = Modifier.testTag("api-command-filter-status"))
                        unavailableReason?.let { UiText(it, style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.testTag("api-command-unavailable")) }
                        Button(onClick = {
                            if (!state.selectedMatchesFeature) return@Button
                            focus.clearFocus()
                            state.result = runCatching {
                                val inputs = ApiInputs(state.arguments(command)); command.validate(inputs)
                                val currentContext = runtimeContext(controller, uiMode)
                                runAvailableApiCommand(command.id, apiCommandCapabilities(controller), state.manualSsaiEnabled(currentContext), state.arguments(command)) {
                                    apiResultText(controller.hostContext, command.execute(controller, inputs))
                                }
                            }.getOrElse { controller.hostContext.getString(R.string.ui_api_failed, it.javaClass.simpleName) }
                            state.resultContext = runtimeContext(controller, uiMode)
                            state.observed = observedPlayback(controller)
                            state.commandDispatched()
                        }, enabled = state.selectedMatchesFeature && unavailableReason == null,
                            modifier = Modifier.fillMaxWidth().testTag("api-command-run")) { UiText("Run API") }
                    }
                    "State" -> Button(onClick = {
                        val field = ApiRuntime.reads.first { it.id == state.stateSelected }
                        val value = runCatching { apiValue(field.read(controller)) }.getOrElse { controller.hostContext.getString(R.string.ui_unavailable, it.javaClass.simpleName) }
                        state.observations = state.observations + (field.id to value)
                    }, modifier = Modifier.fillMaxWidth().testTag("api-state-refresh")) { UiText("Refresh SDK state") }
                    "Events" -> OutlinedButton(onClick = { controller.apiEvents.clear(); controller.apiEventTimes.clear() },
                        modifier = Modifier.fillMaxWidth().testTag("api-events-clear")) { UiText("Clear event counts") }
                }
            }
        }
    }
}

private val allEventIds get() = ApiEvents.player.map { it.id } + ApiEvents.source.map { it.id } +
    ApiEvents.views.map { "PlayerView.${it.id}" } + listOf("OfflineEvent.Error", "OfflineEvent.Info", "OfflineEvent.Warning")

private fun observedPlayback(controller: PlayerController): String = runCatching {
    val player = controller.player
    controller.hostContext.getString(R.string.ui_playback_readout, java.text.DateFormat.getTimeInstance().format(java.util.Date()),
        controller.apiPlayerGeneration, controller.sourceRevision, controller.apiViewRevision) + "\n" +
        "isPlaying=${player.isPlaying}; isPaused=${player.isPaused}; position=${"%.2f".format(player.currentTime)} s; live=${player.isLive}"
}.getOrElse { "Playback state unavailable (${it.javaClass.simpleName})." }

@Composable
private fun RecentApiEvents(controller: PlayerController) {
    val recent = controller.apiEventTimes.entries.sortedByDescending { it.value }.take(5)
    if (!controller.apiEventRecording) UiText("Recording is off. Enable it in Events to observe new events.", style = MaterialTheme.typography.bodySmall)
    else if (recent.isEmpty()) UiText("No events recorded in this app session.", style = MaterialTheme.typography.bodySmall)
    recent.forEach { (id, timestamp) -> UiText(uiFormat(R.string.ui_event_history, id, controller.apiEvents[id] ?: 0, timestamp), style = MaterialTheme.typography.bodySmall) }
}

@Composable
private fun ApiCommandNotes(command: ApiCommand) {
    if (command.id in listOf("android:com.bitmovin.player.PlayerView.on()", "android:com.bitmovin.player.PlayerView.next()", "android:com.bitmovin.player.PlayerView.off()")) UiText("View UI events only. Use Events for playback and source events.", style = MaterialTheme.typography.bodySmall)
    if (command.id.endsWith("PlaylistApi.seek()")) UiText("time: seconds; Start >= 0, End <= 0. null uses the source default.", style = MaterialTheme.typography.bodySmall)
    if (command.id.contains("VrRenderer") || command.id.endsWith("VrApi.setVrRenderer()")) UiText("Replaces PlayerView. Disable the renderer to restore it.", style = MaterialTheme.typography.bodySmall)
}
