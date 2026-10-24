package com.playerlab.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

internal class ApiConfigurationWorkspaceState(applied: ApiOverrides) {
    var selected by mutableStateOf(ApiSettings.fields.first().id)
    var purpose by mutableStateOf(apiPurpose(selected))
    var values by mutableStateOf(applied.values)
    var inputs by mutableStateOf(applied.values)
    var error by mutableStateOf("")
    var message by mutableStateOf("")
    fun select(id: String) { selected = id; purpose = apiPurpose(id); error = ""; message = "" }
    var input: String
        get() = inputs[selected].orEmpty()
        set(value) { inputs = inputs + (selected to value); message = ""; error = "" }
}

@Composable
internal fun ApiConfigurationPanel(controller: PlayerController, state: ApiConfigurationWorkspaceState) {
    val field = ApiSettings.byId.getValue(state.selected)
    var showHelp by remember { mutableStateOf(false) }
    var showPresets by remember(state.selected) { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val keyboardVisible = workspaceKeyboardEditing()
    val presetLabel = uiText("Preset values")
    val purposes = listOf("All features") + ApiSettings.fields.map { apiPurpose(it.id) }.distinct().sorted()
    Column(Modifier.fillMaxSize().testTag("api-settings-panel")) {
        WorkspaceHeader(!keyboardVisible) { Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WorkspacePicker("Feature", state.purpose, purposes.map { it to it }, "api-settings-category", compact = true) { purpose ->
                state.purpose = purpose
                if (purpose != "All features" && apiPurpose(state.selected) != purpose) state.select(ApiSettings.fields.first { apiPurpose(it.id) == purpose }.id)
                focus.clearFocus()
            }
            WorkspacePicker("SDK setting", state.selected,
                ApiSettings.fields.filter { state.purpose == "All features" || apiPurpose(it.id) == state.purpose }.map { it.id to apiDisplayName(it.id) },
                "api-settings-field", searchable = true, compact = true) { state.select(it); focus.clearFocus() }
        } }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (field.kind == ApiValueKind.Choice || field.kind == ApiValueKind.Boolean) {
                val choices = field.choices.ifEmpty { listOf("true", "false") } + if (field.nullable) listOf("null") else emptyList()
                Choices(choices.map { it to it }, state.input, "api-choice") { state.input = it }
            }
            if (field.kind == ApiValueKind.Records) {
                if (state.input == "null") TextButton(onClick = { state.input = "" }) { UiText("Edit list") }
                if (field.nullable) TextButton(onClick = { state.input = "null" }) { UiText("Use null") }
            }
            if (field.kind == ApiValueKind.Records && state.input != "null") ApiRecordEditor(requireNotNull(field.records), state.input, { state.input = it })
            else if (field.kind != ApiValueKind.Boolean && field.kind != ApiValueKind.Choice) OutlinedTextField(state.input, { state.input = it }, label = { UiText("${field.kind} value") },
                textStyle = if (field.kind == ApiValueKind.Script) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodyLarge,
                visualTransformation = if (field.secret || field.drmParameter && field.kind in listOf(ApiValueKind.Text, ApiValueKind.StringMap)) PasswordVisualTransformation() else VisualTransformation.None,
                minLines = if (field.kind == ApiValueKind.Script) if (keyboardVisible) 2 else 3 else 1,
                maxLines = 4,
                // Script and list choices are presets, not a restriction on custom input.
                trailingIcon = if (field.choices.isEmpty()) null else ({ Box {
                    IconButton(onClick = { showPresets = true }, modifier = Modifier.testTag("api-setting-presets")
                        .semantics { contentDescription = presetLabel }) { UiText("⋮", style = MaterialTheme.typography.titleMedium) }
                    DropdownMenu(expanded = showPresets, onDismissRequest = { showPresets = false }) {
                        (field.choices + if (field.nullable) listOf("null") else emptyList()).distinct().forEachIndexed { index, value ->
                            DropdownMenuItem(text = { Text(value, maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) },
                                onClick = { state.input = value; showPresets = false; focus.clearFocus() },
                                modifier = Modifier.testTag("api-setting-preset-$index"))
                        }
                    }
                } }),
                modifier = Modifier.fillMaxWidth().then(if (field.kind == ApiValueKind.Script)
                    Modifier.heightIn(min = if (keyboardVisible) 80.dp else 104.dp, max = 160.dp) else Modifier)
                    .testTag("api-setting-value"))
            val unstaged = state.inputs.containsKey(state.selected) && state.inputs[state.selected] != state.values[state.selected]
            UiText(when {
                unstaged -> "Edited value is not staged. Stage override before Apply."
                state.selected in state.values && state.values[state.selected] != controller.apiOverrides.values[state.selected] -> "Staged override; not applied."
                state.selected in state.values -> "Applied override"
                state.selected in controller.apiOverrides.values -> "Removal staged. Apply to restore the standard form or SDK default."
                else -> "Using the standard form or SDK default"
            }, style = MaterialTheme.typography.labelMedium, modifier = Modifier.testTag("api-setting-draft-status"))
            TextButton(onClick = { showHelp = true }, modifier = Modifier.testTag("api-setting-help")) { UiText("Setting details and requirements") }
            if (field.id.contains("NetworkEngine.Cronet") || field.id.endsWith("SourceNetworkConfig.engine")) {
                OutlinedButton(onClick = { ApiNativeFactories.prepareCronet(controller.hostContext) }, modifier = Modifier.testTag("api-cronet-prepare")) { UiText("Prepare Google Play services Cronet") }
                UiText(ApiNativeFactories.providerStatus, modifier = Modifier.testTag("api-cronet-status"), style = MaterialTheme.typography.bodySmall)
            }
        }
        if (state.error.isNotEmpty()) UiText(state.error, color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(horizontal = 12.dp).testTag("api-settings-error"), style = MaterialTheme.typography.bodySmall)
        if (state.message.isNotEmpty()) UiText(state.message, maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 12.dp).testTag("api-setting-stage-status"), style = MaterialTheme.typography.bodySmall)
        Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = {
                runCatching { field.normalize(state.input) }.onSuccess {
                    state.values = state.values + (state.selected to it); state.inputs = state.inputs + (state.selected to it); state.error = ""
                    state.message = "Override staged. Choose Apply SDK to send it to the player."
                }.onFailure { state.error = it.message ?: "Invalid SDK field value." }
                focus.clearFocus()
            }, modifier = Modifier.weight(1f).testTag("api-setting-stage")) { UiText("Stage override") }
            TextButton(onClick = { state.values = state.values - state.selected; state.inputs = state.inputs - state.selected; state.error = ""; state.message = "Override removal staged." },
                enabled = state.selected in state.values, modifier = Modifier.testTag("api-setting-remove")) { UiText("Remove") }
        }
        val changed = state.values.count { (id, value) -> controller.apiOverrides.values[id] != value }
        val removed = controller.apiOverrides.values.keys.count { it !in state.values }
        WorkspaceActions(uiFormat(R.string.ui_override_summary, controller.apiOverrides.values.size, changed, removed),
            "api-settings-reset", "api-settings-apply", "Apply SDK", enabled = state.values != controller.apiOverrides.values,
            reset = { state.values = controller.apiOverrides.values; state.inputs = state.values; state.error = ""; state.message = ""; focus.clearFocus() },
            apply = {
                focus.clearFocus()
                runCatching { ApiOverrides.validate(state.values) }.onSuccess {
                    controller.applyPlayerSettings(controller.playerSettings, it)
                    state.error = ""
                    state.message = controller.configurationStatus
                }.onFailure { state.error = it.message ?: "Invalid SDK configuration. Draft values are retained." }
            })
    }
    if (showHelp) AlertDialog(onDismissRequest = { showHelp = false }, title = { UiText(apiDisplayName(field.id)) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val help = apiHelpText(field.help)
            help.paragraphs.forEach { UiText(it) }
            help.example?.let { Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) }
            if (field.kind == ApiValueKind.Script) UiText("Pure JavaScript using a bounded value snapshot. No Java or Android access. Limits: 50000 interpreter instructions, 25 ms thread CPU time, 250 ms wall time, stack depth 64. Without CPU timing the wall limit is 75 ms. Native built-ins are not preempted; this is not a separate-process memory sandbox.")
        } }, confirmButton = { TextButton(onClick = { showHelp = false }) { UiText("Close") } })
}

@Composable
internal fun ApiCallbackOutcomes(controller: PlayerController) {
    var reasons by remember(controller.player, controller.sourceRevision) { mutableStateOf(emptyMap<String, String>()) }
    var counts by remember(controller.player, controller.sourceRevision) { mutableStateOf(emptyMap<String, Pair<Int, Int>>()) }
    OutlinedButton(onClick = {
        counts = controller.apiCallbacks.snapshot() + controller.apiSourceCallbacks.snapshot()
        reasons = controller.apiCallbacks.fallbackReasons() + controller.apiSourceCallbacks.fallbackReasons()
    }, modifier = Modifier.testTag("api-callback-refresh")) { UiText("Refresh callback outcomes") }
    if (counts.isEmpty()) UiText("No callback outcomes have been read.", style = MaterialTheme.typography.bodySmall)
    counts.forEach { (id, count) -> UiText(uiFormat(R.string.ui_callback_readout, apiDisplayName(id), count.first, count.second, reasons[id] ?: uiText("None")),
        style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-callback-$id")) }
}
