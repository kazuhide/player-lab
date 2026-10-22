package com.playerlab.android

import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

@Composable
internal fun ApiConfigurationPanel(controller: PlayerController) {
    var expanded by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(ApiSettings.fields.first().id) }
    var values by remember(controller.apiOverrides) { mutableStateOf(controller.apiOverrides.values) }
    var input by remember(selected, controller.apiOverrides) { mutableStateOf(values[selected].orEmpty()) }
    var error by remember { mutableStateOf("") }
    var callbackReasons by remember(controller.player, controller.sourceRevision) { mutableStateOf(emptyMap<String, String>()) }
    var callbackCounts by remember(controller.player, controller.sourceRevision) { mutableStateOf(emptyMap<String, Pair<Int, Int>>()) }
    Button(onClick = { expanded = !expanded }, modifier = Modifier.testTag("api-settings-toggle")) {
        Text(if (expanded) "Hide SDK API settings" else "SDK API settings")
    }
    if (!expanded) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Additional Player, Source and Tweaks configuration", style = MaterialTheme.typography.titleMedium)
        Text("Each entry is a typed SDK field. An override takes precedence over the standard form. Apply recreates the player and reloads the current source. Removing an override restores the standard form or SDK default on the next Apply.", style = MaterialTheme.typography.bodySmall)
        ApiStartupPanel(controller)
        OutlinedTextField(query, { query = it }, label = { Text("Find SDK field") },
            singleLine = true, modifier = Modifier.fillMaxWidth().testTag("api-settings-search"))
        ApiSettings.fields.filter { it.id.contains(query, ignoreCase = true) }.forEach { field ->
            Button(onClick = { selected = field.id; input = values[field.id].orEmpty(); error = "" },
                modifier = Modifier.testTag("api-select-${field.id}")) {
                Text(field.id.removePrefix("android:com.bitmovin.player.api.") + if (field.id in values) " (overridden)" else "")
            }
        }
        val field = ApiSettings.byId.getValue(selected)
        Text(field.id.removePrefix("android:"), style = MaterialTheme.typography.labelLarge)
        Text("${field.kind}. ${field.help}", style = MaterialTheme.typography.bodySmall)
        if (field.kind == ApiValueKind.Script) Text("Callbacks accept a pure input value snapshot and return the documented value. Only your staged body is executed; code is kept in memory, with no Java/Android access. Budgets are 50000 interpreter instructions, 25 milliseconds of thread CPU time, 250 milliseconds of wall time, and a stack depth of 64. If CPU time is unavailable, the wall limit is 75 milliseconds. Limits are checked at execution/conversion checkpoints; native built-ins are not preempted. This is not a separate-process memory sandbox.", style = MaterialTheme.typography.bodySmall)
        if (field.choices.isNotEmpty() || field.kind == ApiValueKind.Boolean) {
            val choices = field.choices.ifEmpty { listOf("true", "false") } + if (field.nullable) listOf("null") else emptyList()
            choices.forEach { choice ->
                Button(onClick = { input = choice }, modifier = Modifier.testTag("api-choice-$choice")) { Text(choice) }
            }
        }
        if (field.kind == ApiValueKind.Records) {
            if (input == "null") Button(onClick = { input = "" }) { Text("Edit list") }
            if (field.nullable) Button(onClick = { input = "null" }) { Text("Use null") }
        }
        if (field.kind == ApiValueKind.Records && input != "null") ApiRecordEditor(requireNotNull(field.records), input, { input = it })
        else OutlinedTextField(input, { input = it }, label = { Text("SDK field value") },
            textStyle = if (field.kind == ApiValueKind.Script) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodyLarge,
            visualTransformation = if (field.secret || field.drmParameter && field.kind in listOf(ApiValueKind.Text, ApiValueKind.StringMap)) PasswordVisualTransformation() else VisualTransformation.None,
            modifier = Modifier.fillMaxWidth().testTag("api-setting-value"))
        Button(onClick = {
            runCatching { field.normalize(input) }.onSuccess {
                values = values + (selected to it); error = ""
            }.onFailure { error = it.message ?: "Invalid SDK field value." }
        }, modifier = Modifier.testTag("api-setting-stage")) { Text("Use this override") }
        Button(onClick = { values = values - selected; input = ""; error = "" },
            enabled = selected in values, modifier = Modifier.testTag("api-setting-remove")) { Text("Remove this override") }
        if (field.id.contains("NetworkEngine.Cronet") || field.id.endsWith("SourceNetworkConfig.engine")) {
            Button(onClick = { ApiNativeFactories.prepareCronet(controller.hostContext) }, modifier = Modifier.testTag("api-cronet-prepare")) { Text("Prepare Google Play services Cronet") }
            Text(ApiNativeFactories.providerStatus, modifier = Modifier.testTag("api-cronet-status"), style = MaterialTheme.typography.bodySmall)
        }
        Text("Staged overrides", style = MaterialTheme.typography.titleSmall)
        values.keys.forEach { Text(it.removePrefix("android:com.bitmovin.player.api."), style = MaterialTheme.typography.bodySmall) }
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("api-settings-error"))
        Button(onClick = {
            runCatching { ApiOverrides.validate(values) }.onSuccess {
                controller.applyPlayerSettings(controller.playerSettings, it); error = ""
            }.onFailure { error = it.message ?: "Invalid SDK configuration." }
        }, enabled = values != controller.apiOverrides.values, modifier = Modifier.testTag("api-settings-apply")) { Text("Apply SDK settings and restart") }
        Button(onClick = { values = controller.apiOverrides.values; input = values[selected].orEmpty(); error = "" },
            modifier = Modifier.testTag("api-settings-reset")) { Text("Reset SDK draft") }
        Text("Applied SDK override code", style = MaterialTheme.typography.titleSmall)
        if (controller.configurationStatus.isNotEmpty()) Text(controller.configurationStatus, style = MaterialTheme.typography.bodySmall)
        Text("Apply these assignments to fresh configuration objects before creating Player, Source and PlayerView. Use mutable playerConfig and playerViewConfig variables for copy assignments. No license values are included.", style = MaterialTheme.typography.bodySmall)
        SelectionContainer { Text(controller.apiOverrides.code().ifEmpty { "// No additional SDK overrides." },
            style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, modifier = Modifier.testTag("api-settings-code")) }
        Button(onClick = { callbackCounts = controller.apiCallbacks.snapshot() + controller.apiSourceCallbacks.snapshot(); callbackReasons = controller.apiCallbacks.fallbackReasons() + controller.apiSourceCallbacks.fallbackReasons() }, modifier = Modifier.testTag("api-callback-refresh")) { Text("Refresh callback outcomes") }
        callbackCounts.forEach { (id, count) -> Text("${id.removePrefix("android:com.bitmovin.player.api.")}: calls=${count.first}; fallback=${count.second}; last fallback reason=${callbackReasons[id] ?: "none"}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-callback-$id")) }
    }
}
