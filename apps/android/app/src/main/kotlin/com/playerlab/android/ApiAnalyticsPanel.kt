package com.playerlab.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.bitmovin.analytics.api.LogLevel
import com.bitmovin.analytics.api.RetryPolicy
import com.bitmovin.player.api.analytics.AnalyticsApi.Companion.analytics
import com.bitmovin.player.api.analytics.SourceAnalyticsApi.Companion.analytics

@Composable
internal fun ApiAnalyticsPanel(controller: PlayerController) {
    var expanded by remember { mutableStateOf(false) }
    var draft by remember(controller.apiAnalyticsSettings) { mutableStateOf(controller.apiAnalyticsSettings) }
    var custom by remember { mutableStateOf(emptyMap<String, String>()) }
    var result by remember(controller.player, controller.sourceRevision) { mutableStateOf("") }
    fun run(action: () -> Any?) {
        result = runCatching { apiValue(action()) }.getOrElse { "Analytics API failed (${it.javaClass.simpleName}). Check metadata, collection mode and source state." }
    }
    Button(onClick = { expanded = !expanded }, modifier = Modifier.testTag("analytics-toggle")) { Text(if (expanded) "Hide Analytics controls" else "Analytics controls") }
    if (!expanded) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Analytics collection and metadata", style = MaterialTheme.typography.titleMedium)
        Text("The collector sends playback samples to the configured Analytics account. Use Bitmovin Dashboard to inspect delivery and session details. A local API result confirms the SDK call, while Dashboard confirms ingestion. Metadata edits remain drafts until Apply or an explicit runtime action.", style = MaterialTheme.typography.bodySmall)
        listOf("Build key", "Deferred license", "Disabled").forEach { mode ->
            Button(onClick = { draft = draft.copy(mode = mode) }, enabled = draft.mode != mode, modifier = Modifier.testTag("analytics-mode-$mode")) { Text(mode) }
        }
        Text("Build key uses local build configuration; a blank build key disables collection. Deferred license asks the SDK to obtain the associated Analytics license. An optional override stays in this app session.", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(draft.licenseOverride, { draft = draft.copy(licenseOverride = it) }, label = { Text("Optional Analytics license override") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag("analytics-license"))
        Row { Switch(draft.adTrackingDisabled, { draft = draft.copy(adTrackingDisabled = it) }); Text("Disable client-side ad tracking") }
        Row { Switch(draft.randomizeUserId, { draft = draft.copy(randomizeUserId = it) }, modifier = Modifier.testTag("analytics-random-user")); Text("Randomize user ID") }
        Text("Request retry policy", style = MaterialTheme.typography.labelLarge)
        RetryPolicy.entries.forEach { policy -> Button(onClick = { draft = draft.copy(retryPolicy = policy) }, enabled = draft.retryPolicy != policy) { Text(policy.name) } }
        OutlinedTextField(draft.backendUrl, { draft = draft.copy(backendUrl = it) }, label = { Text("Analytics backend URL (blank uses SDK default)") }, modifier = Modifier.fillMaxWidth())
        Text("Collector log level (DEBUG includes diagnostic details)", style = MaterialTheme.typography.labelLarge)
        LogLevel.entries.forEach { level -> Button(onClick = { draft = draft.copy(logLevel = level) }, enabled = draft.logLevel != level) { Text(level.name) } }
        Row { Switch(draft.ssaiEngagementTracking, { draft = draft.copy(ssaiEngagementTracking = it) }); Text("Legacy SSAI engagement flag (SDK ignores this setting)") }
        Text("Error transformation", style = MaterialTheme.typography.labelLarge)
        listOf("Default", "Redact message", "Custom").forEach { strategy -> Button(onClick = { draft = draft.copy(errorStrategy = strategy) }, enabled = draft.errorStrategy != strategy, modifier = Modifier.testTag("analytics-error-strategy-$strategy")) { Text(strategy) } }
        if (draft.errorStrategy == "Custom") {
            Text("Pure JavaScript body using input: {code, message, severity, originalErrorType}. Return a partial {code, message, severity} error object, or null to retain the original error. The public collector callback returns a non-null error. severity is CRITICAL or INFO. Original SDK objects are not exposed. The same callback execution bounds and retirement rules apply.", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(draft.errorCallbackBody, { draft = draft.copy(errorCallbackBody = it) }, label = { Text("Analytics error callback body") }, textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.fillMaxWidth().testTag("analytics-error-body"))
        }
        AnalyticsMetadataEditor("Default metadata", "analytics-default", analyticsDefaultKeys, draft.defaults) { draft = draft.copy(defaults = it) }
        AnalyticsMetadataEditor("Source / program metadata", "analytics-source", analyticsSourceKeys, draft.source) { draft = draft.copy(source = it) }
        Button(onClick = { run {
            draft.playerConfig("validation-only"); controller.applyPlayerSettings(controller.playerSettings, controller.apiOverrides, draft)
        } }, enabled = draft != controller.apiAnalyticsSettings, modifier = Modifier.testTag("analytics-apply")) { Text("Apply Analytics settings and restart player") }
        Button(onClick = { draft = controller.apiAnalyticsSettings }, modifier = Modifier.testTag("analytics-reset")) { Text("Reset Analytics draft") }
        SelectionContainer { Text(controller.apiAnalyticsSettings.code(), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, modifier = Modifier.testTag("analytics-code")) }
        AnalyticsMetadataEditor("Runtime custom data", "analytics-custom", analyticsCustomKeys, custom) { custom = it }
        Button(onClick = { run { requireNotNull(controller.player.analytics).sendCustomDataEvent(analyticsCustomData(custom)) } }, modifier = Modifier.testTag("analytics-custom-event")) { Text("Send custom data event") }
        Button(onClick = { run { requireNotNull(controller.player.source?.analytics).customData = analyticsCustomData(custom) } }, modifier = Modifier.testTag("analytics-source-custom")) { Text("Set current source custom data") }
        Button(onClick = { run { requireNotNull(controller.player.analytics).programChange(draft.sourceMetadata()) } }, modifier = Modifier.testTag("analytics-program-change")) { Text("Signal program change with source draft") }
        Button(onClick = { run {
            val api = requireNotNull(controller.player.analytics)
            mapOf("impressionId" to api.impressionId, "userId" to api.userId, "sourceMetadata" to controller.player.source?.analytics?.metadata?.let(::analyticsMetadataValues))
        } }, modifier = Modifier.testTag("analytics-state")) { Text("Read Analytics SDK state") }
        AnalyticsSsaiControls(controller)
        SelectionContainer { Text(result, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("analytics-result")) }
    }
}

@Composable
internal fun AnalyticsMetadataEditor(label: String, tag: String, keys: List<String>, values: Map<String, String>, onChange: (Map<String, String>) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(keys.first()) }
    var input by remember(selected, values) { mutableStateOf(values[selected].orEmpty()) }
    var error by remember { mutableStateOf("") }
    Button(onClick = { expanded = !expanded }, modifier = Modifier.testTag("$tag-toggle")) { Text(label) }
    if (!expanded) return
    Text("Choose a named field, enter its value and stage it. Remove a field to restore its null/default value. Source metadata takes precedence over default metadata.", style = MaterialTheme.typography.bodySmall)
    OutlinedTextField(query, { query = it }, label = { Text("Find metadata field") }, modifier = Modifier.fillMaxWidth().testTag("$tag-search"), singleLine = true)
    val matches = keys.filter { it.contains(query, ignoreCase = true) }
    matches.take(12).forEach { name ->
        Button(onClick = { selected = name }, modifier = Modifier.testTag("$tag-select-$name")) { Text(name + if (name in values) " (staged)" else "") }
    }
    if (matches.size > 12) Text("Narrow the search to find another field.", style = MaterialTheme.typography.bodySmall)
    Text(selected, style = MaterialTheme.typography.labelLarge)
    if (selected == "isLive") listOf("true", "false").forEach { value -> Button(onClick = { input = value }) { Text(value) } }
    OutlinedTextField(input, { input = it }, label = { Text("Metadata value") }, modifier = Modifier.fillMaxWidth().testTag("$tag-value"))
    Button(onClick = {
        runCatching { (values + (selected to input)).also { validateAnalyticsMetadata(it, keys) } }
            .onSuccess { onChange(it); error = "" }.onFailure { error = "Invalid metadata type or value." }
    }, modifier = Modifier.testTag("$tag-stage")) { Text("Stage metadata field") }
    Button(onClick = { onChange(values - selected); error = "" }, enabled = selected in values, modifier = Modifier.testTag("$tag-remove")) { Text("Remove metadata field") }
    Text(values.keys.joinToString(", ").ifEmpty { "No metadata staged." }, style = MaterialTheme.typography.bodySmall)
    if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
}
