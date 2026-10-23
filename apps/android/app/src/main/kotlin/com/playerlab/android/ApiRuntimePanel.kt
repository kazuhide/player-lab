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
    fun invalidateFor(context: ApiRuntimeContext) {
        if (resultContext != context) { result = ""; resultContext = null }
        observed = ""
        observations = emptyMap()
    }
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
                        state.purpose = purpose
                        if (purpose != "All features" && apiPurpose(state.selected) != purpose) state.select(ApiRuntime.commands.first { apiPurpose(it.id) == purpose }.id)
                        focus.clearFocus()
                    }
                    WorkspacePicker("Operation", state.selected, ApiRuntime.commands.filter { state.purpose == "All features" || apiPurpose(it.id) == state.purpose }.map { it.id to it.label },
                        "api-command-selector", searchable = true, compact = true) { state.select(it); focus.clearFocus() }
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
                    if (command.arguments.isEmpty()) Text("No arguments.", style = MaterialTheme.typography.bodyMedium)
                    else {
                        val selectedArgument = command.arguments.firstOrNull { it.name == state.argument } ?: command.arguments.first()
                        WorkspacePicker("Argument", selectedArgument.name, command.arguments.map { it.name to it.name }, "api-argument-selector", compact = true) { state.argument = it; focus.clearFocus() }
                        OutlinedTextField(state.arguments(command)[selectedArgument.name].orEmpty(), { state.setArgument(command, selectedArgument.name, it) },
                            label = { Text(selectedArgument.name) },
                            textStyle = if (selectedArgument.multiline) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodyLarge,
                            singleLine = !selectedArgument.multiline, maxLines = if (selectedArgument.multiline) 4 else 1,
                            modifier = Modifier.fillMaxWidth().testTag("api-argument-${selectedArgument.name}"))
                        if (selectedArgument.choices.isNotEmpty()) Choices(selectedArgument.choices.map { it to it }, state.arguments(command)[selectedArgument.name].orEmpty(), "api-argument-choice") {
                            state.setArgument(command, selectedArgument.name, it)
                        }
                    }
                    ApiCommandNotes(command)
                    if (state.result.isNotEmpty()) {
                        WorkspaceHeading("Call result", "A submitted command does not confirm the media effect. SDK events and state provide separate observations.")
                        SelectionContainer { Text(state.result, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-command-result")) }
                    }
                    if (controller.apiAsyncResult.isNotEmpty()) Text(controller.apiAsyncResult, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-async-result"))
                    WorkspaceHeading("Observed playback state")
                    Text(state.observed.ifEmpty { "Not read yet. Run an operation or refresh the observation." }, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-related-state"))
                    OutlinedButton(onClick = { state.observed = observedPlayback(controller) }, modifier = Modifier.testTag("api-related-state-refresh")) { Text("Refresh playback state") }
                    WorkspaceHeading("Recent SDK events", "App-session history; these events are not proof that the selected operation completed.")
                    RecentApiEvents(controller)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { state.section = "State" }, modifier = Modifier.testTag("api-related-state-open")) { Text("All SDK state") }
                        TextButton(onClick = { state.section = "Events" }, modifier = Modifier.testTag("api-related-events-open")) { Text("All SDK events") }
                    }
                    if (command.id.contains("CustomMessage") || command.id == "app:custom-message-send") {
                        Text("The host endpoint is playerLabMessage(data: String). A custom Web UI must register its incoming message handler. Only this session's latest messages are shown.", style = MaterialTheme.typography.bodySmall)
                        controller.apiHostMessages.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                }
                "State" -> {
                    WorkspaceHeading(apiDisplayName(state.stateSelected), "Refresh reads this SDK value once. Keys and opaque request/configuration objects are excluded. Lists and text are bounded for display.")
                    SelectionContainer { Text(state.observations[state.stateSelected] ?: "Not read yet", style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.testTag("api-state-${state.stateSelected}")) }
                    Text("Ad values require an active ad or a selected SSAI test object. Vector3 values inspect the last moveViewingDirection input; activeAdBreak and activeLinearAd read actual SDK state.", style = MaterialTheme.typography.bodySmall)
                }
                "Events" -> {
                    ConfigToggle("Record SDK events", controller.apiEventRecording, "api-event-recording") { controller.apiEventRecording = it }
                    Text("Counts cover this app session. Zero means no recorded occurrence. SDK timestamps are milliseconds since the Unix epoch. Event payloads, headers and keys are excluded.", style = MaterialTheme.typography.bodySmall)
                    val id = state.eventSelected
                    Text("$id: ${controller.apiEvents[id] ?: 0}; latest timestamp=${controller.apiEventTimes[id] ?: "not recorded"}",
                        modifier = Modifier.testTag("api-event-$id"), style = MaterialTheme.typography.bodyMedium)
                    WorkspaceHeading("Recent SDK events", "App-session history, including events before the latest API call.")
                    RecentApiEvents(controller)
                }
            }
        }
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                when (state.section) {
                    "Commands" -> {
                        Text("Run target: ${command.label}", style = MaterialTheme.typography.labelMedium, maxLines = 2,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.testTag("api-run-target"))
                        Button(onClick = {
                            focus.clearFocus()
                            state.result = runCatching {
                                val inputs = ApiInputs(state.arguments(command)); command.validate(inputs)
                                apiValue(command.execute(controller, inputs))
                            }.getOrElse { "API failed (${it.javaClass.simpleName}). Check argument types, source state and SDK events." }
                            state.resultContext = runtimeContext(controller, uiMode)
                            state.observed = observedPlayback(controller)
                        }, modifier = Modifier.fillMaxWidth().testTag("api-command-run")) { Text("Run API") }
                    }
                    "State" -> Button(onClick = {
                        val field = ApiRuntime.reads.first { it.id == state.stateSelected }
                        val value = runCatching { apiValue(field.read(controller)) }.getOrElse { "Unavailable (${it.javaClass.simpleName})" }
                        state.observations = state.observations + (field.id to value)
                    }, modifier = Modifier.fillMaxWidth().testTag("api-state-refresh")) { Text("Refresh SDK state") }
                    "Events" -> OutlinedButton(onClick = { controller.apiEvents.clear(); controller.apiEventTimes.clear() },
                        modifier = Modifier.fillMaxWidth().testTag("api-events-clear")) { Text("Clear event counts") }
                }
            }
        }
    }
}

private val allEventIds get() = ApiEvents.player.map { it.id } + ApiEvents.source.map { it.id } +
    ApiEvents.views.map { "PlayerView.${it.id}" } + listOf("OfflineEvent.Error", "OfflineEvent.Info", "OfflineEvent.Warning")

private fun observedPlayback(controller: PlayerController): String = runCatching {
    val player = controller.player
    "Read at ${java.text.DateFormat.getTimeInstance().format(java.util.Date())}; player generation ${controller.apiPlayerGeneration}; source revision ${controller.sourceRevision}; view revision ${controller.apiViewRevision}.\n" +
        "isPlaying=${player.isPlaying}; isPaused=${player.isPaused}; position=${"%.2f".format(player.currentTime)} s; live=${player.isLive}"
}.getOrElse { "Playback state unavailable (${it.javaClass.simpleName})." }

@Composable
private fun RecentApiEvents(controller: PlayerController) {
    val recent = controller.apiEventTimes.entries.sortedByDescending { it.value }.take(5)
    if (!controller.apiEventRecording) Text("Recording is off. Enable it in Events to observe new events.", style = MaterialTheme.typography.bodySmall)
    else if (recent.isEmpty()) Text("No events recorded in this app session.", style = MaterialTheme.typography.bodySmall)
    recent.forEach { (id, timestamp) -> Text("$id: ${controller.apiEvents[id] ?: 0}; timestamp=$timestamp", style = MaterialTheme.typography.bodySmall) }
}

@Composable
private fun ApiCommandNotes(command: ApiCommand) {
    if (command.id in listOf("android:com.bitmovin.player.PlayerView.on()", "android:com.bitmovin.player.PlayerView.next()", "android:com.bitmovin.player.PlayerView.off()")) Text("PlayerView subscriptions receive view UI events, such as FullscreenEnter/Exit. Playback and source events are recorded on Player and Source in the Events tab; they are not forwarded by this view subscription.", style = MaterialTheme.typography.bodySmall)
    if (command.id.endsWith("PlaylistApi.seek()")) Text("time is SeekTarget.offset in seconds. Start uses a nonnegative offset and End uses a nonpositive offset; the SDK corrects invalid values to stream boundaries. null uses the default reference for the source. useSeekTarget=false passes a null target to the SDK.", style = MaterialTheme.typography.bodySmall)
    if (command.id.contains("VrRenderer") || command.id.endsWith("VrApi.setVrRenderer()")) Text("The host renderer replaces PlayerView with a real decoder-backed OpenGL surface. Disabling it restores PlayerView. Update scripts receive {delta, viewingDirection}; return {text?, move?: {phi,x,y}} or null. delta is seconds. everyFrames limits script execution frequency; the SDK frame clock still updates at the display rate. User callbacks are removed with their renderer. Check app:vr-renderer state for decoded frames and callback results.", style = MaterialTheme.typography.bodySmall)
}
