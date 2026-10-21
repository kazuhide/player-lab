package com.playerlab.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
internal fun ApiRuntimePanel(controller: PlayerController) {
    var expanded by remember { mutableStateOf(false) }
    var section by remember { mutableStateOf("Commands") }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(ApiRuntime.commands.first().id) }
    val command = ApiRuntime.commands.first { it.id == selected }
    var arguments by remember(selected) { mutableStateOf(command.arguments.associate { it.name to it.example }) }
    var result by remember(controller.player, controller.sourceRevision) { mutableStateOf("") }
    var observations by remember(controller.player, controller.sourceRevision) { mutableStateOf(emptyMap<String, String>()) }
    Button(onClick = { expanded = !expanded }, modifier = Modifier.testTag("api-runtime-toggle")) {
        Text(if (expanded) "Hide SDK API controls" else "SDK API controls")
    }
    if (!expanded) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("SDK operations, state and events", style = MaterialTheme.typography.titleMedium)
        Text("Commands target the current player, source or attached view. Cast, ads, encrypted content, low latency and VR require their SDK dependencies, compatible content or device services. A submitted command does not by itself confirm its media effect.", style = MaterialTheme.typography.bodySmall)
        listOf("Commands", "State", "Events").forEach { name ->
            Button(onClick = { section = name }, enabled = section != name,
                modifier = Modifier.testTag("api-section-$name")) { Text(name) }
        }
        OutlinedTextField(query, { query = it }, label = { Text("Find SDK API") },
            modifier = Modifier.fillMaxWidth().testTag("api-runtime-search"), singleLine = true)
        when (section) {
            "Commands" -> {
                ApiRuntime.commands.filter { it.id.contains(query, ignoreCase = true) || it.label.contains(query, ignoreCase = true) }.forEach { item ->
                    Button(onClick = { selected = item.id; result = "" }, modifier = Modifier.testTag("api-command-${item.id}")) {
                        Text(item.label)
                    }
                }
                Text(command.label, style = MaterialTheme.typography.labelLarge)
                command.arguments.forEach { argument ->
                    OutlinedTextField(arguments[argument.name].orEmpty(), { value -> arguments = arguments + (argument.name to value) },
                        label = { Text(argument.name) }, modifier = Modifier.fillMaxWidth().testTag("api-argument-${argument.name}"), singleLine = true)
                    argument.choices.forEach { choice ->
                        Button(onClick = { arguments = arguments + (argument.name to choice) }) { Text(choice) }
                    }
                }
                Button(onClick = {
                    result = runCatching { apiValue(command.execute(controller, ApiInputs(arguments))) }
                        .getOrElse { "API failed (${it.javaClass.simpleName}). Check argument types, source state and SDK events." }
                }, modifier = Modifier.testTag("api-command-run")) { Text("Run SDK API") }
                SelectionContainer { Text(result, modifier = Modifier.testTag("api-command-result")) }
                if (controller.apiAsyncResult.isNotEmpty()) Text(controller.apiAsyncResult, modifier = Modifier.testTag("api-async-result"))
            }
            "State" -> {
                Text("Refresh reads SDK values once. Keys and opaque SDK request/configuration objects are not exported. Lists show the first entries and text is bounded for display. Ad interface fields use the active client-side ad or the selected SSAI test object; activeAdBreak and activeLinearAd always read the actual SDK state.", style = MaterialTheme.typography.bodySmall)
                Button(onClick = {
                    observations = ApiRuntime.reads.associate { field -> field.id to runCatching { apiValue(field.read(controller)) }
                        .getOrElse { "Unavailable (${it.javaClass.simpleName})" } }
                }, modifier = Modifier.testTag("api-state-refresh")) { Text("Refresh SDK state") }
                ApiRuntime.reads.filter { it.id.contains(query, ignoreCase = true) }.forEach { field ->
                    Text(field.id.removePrefix("android:com.bitmovin.player."), style = MaterialTheme.typography.labelLarge)
                    SelectionContainer { Text(observations[field.id] ?: "Not read yet", style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.testTag("api-state-${field.id}")) }
                }
            }
            "Events" -> {
                Row {
                    Text("Record SDK events")
                    Switch(controller.apiEventRecording, { controller.apiEventRecording = it }, modifier = Modifier.testTag("api-event-recording"))
                }
                Text("Values are occurrence counts for this app session. Zero means no occurrence has been recorded. The latest timestamp is read from SDK Event.timestamp in milliseconds since the Unix epoch. Keys, request headers and other payloads are not copied into this log.", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { controller.apiEvents.clear(); controller.apiEventTimes.clear() }, modifier = Modifier.testTag("api-events-clear")) { Text("Clear event counts") }
                (ApiEvents.player.map { it.id } + ApiEvents.source.map { it.id }).filter { it.contains(query, ignoreCase = true) }.forEach { id ->
                    Text("$id: ${controller.apiEvents[id] ?: 0}; latest timestamp=${controller.apiEventTimes[id] ?: "not recorded"}", modifier = Modifier.testTag("api-event-$id"), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
