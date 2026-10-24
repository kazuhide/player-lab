package com.playerlab.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
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
    var page by remember { mutableStateOf("Collection") }
    var setting by remember { mutableStateOf("Collection mode") }
    var draft by remember { mutableStateOf(controller.apiAnalyticsSettings) }
    var custom by remember { mutableStateOf(emptyMap<String, String>()) }
    var operation by remember { mutableStateOf("analytics-state") }
    var result by remember(controller.player, controller.sourceRevision) { mutableStateOf("") }
    val editors = remember { mutableMapOf<String, AnalyticsMetadataState>() }
    val keyboardVisible = workspaceKeyboardEditing()
    fun run(action: () -> Any?) {
        result = runCatching { apiResultText(controller.hostContext, action()) }.getOrElse { controller.hostContext.getString(R.string.ui_analytics_api_failed, it.javaClass.simpleName) }
    }
    val pages = listOf("Collection", "Identity", "Delivery", "Errors", "Default metadata", "Source metadata", "Runtime custom data", "Runtime actions", "SSAI", "Code")
    val settings = when (page) {
        "Collection" -> listOf("Collection mode", "License override", "Ad tracking", "Legacy SSAI flag")
        "Delivery" -> listOf("Retry policy", "Backend URL", "Log level")
        else -> emptyList()
    }
    val actions = listOf("analytics-state" to "Read Analytics SDK state", "analytics-custom-event" to "Send custom data event",
        "analytics-source-custom" to "Set current source custom data", "analytics-program-change" to "Signal program change with source draft")
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(!keyboardVisible) { Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WorkspacePicker("Analytics", page, pages.map { it to it }, "analytics-page", compact = true) { page = it; setting = "" }
            if (settings.isNotEmpty()) WorkspacePicker("Setting", setting.takeIf { it in settings } ?: settings.first(),
                settings.map { it to it }, "analytics-setting", compact = true) { setting = it }
            if (page == "Runtime actions") WorkspacePicker("Operation", operation, actions, "analytics-action-selector", compact = true) { operation = it }
        } }
        Box(Modifier.weight(1f)) {
            RetainedWorkspacePage(page == "SSAI") { AnalyticsSsaiControls(controller) }
            if (page != "SSAI") Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (page) {
                    "Collection" -> when (setting.takeIf { it in settings } ?: settings.first()) {
                        "Collection mode" -> {
                            Choices(listOf("Build key", "Deferred license", "Disabled").map { it to it }, draft.mode, "analytics-mode") { draft = draft.copy(mode = it) }
                            UiText("Blank build key disables collection. Check received sessions in Bitmovin Dashboard.", style = MaterialTheme.typography.bodySmall)
                        }
                        "License override" -> OutlinedTextField(draft.licenseOverride, { draft = draft.copy(licenseOverride = it) }, label = { UiText("Optional Analytics license override") }, visualTransformation = PasswordVisualTransformation(), supportingText = { UiText("Kept only in this app session; excluded from exported code.") }, modifier = Modifier.fillMaxWidth().testTag("analytics-license"))
                        "Ad tracking" -> ConfigToggle("Disable client-side ad tracking", draft.adTrackingDisabled, "analytics-ad-tracking") { draft = draft.copy(adTrackingDisabled = it) }
                        "Legacy SSAI flag" -> { ConfigToggle("Legacy SSAI engagement flag", draft.ssaiEngagementTracking, "analytics-ssai-legacy") { draft = draft.copy(ssaiEngagementTracking = it) }; UiText("The SDK ignores this legacy setting. SSAI engagement tracking is always enabled.", style = MaterialTheme.typography.bodySmall) }
                    }
                    "Identity" -> ConfigToggle("Randomize user ID", draft.randomizeUserId, "analytics-random-user") { draft = draft.copy(randomizeUserId = it) }
                    "Delivery" -> when (setting.takeIf { it in settings } ?: settings.first()) {
                        "Retry policy" -> Choices(RetryPolicy.entries.map { it to it.name }, draft.retryPolicy, "analytics-retry") { draft = draft.copy(retryPolicy = it) }
                        "Backend URL" -> ConfigField("Analytics backend URL", draft.backendUrl, { draft = draft.copy(backendUrl = it) }, "analytics-backend", helper = "Blank uses the SDK default.")
                        "Log level" -> { Choices(LogLevel.entries.map { it to it.name }, draft.logLevel, "analytics-log") { draft = draft.copy(logLevel = it) }; UiText("DEBUG includes diagnostic details. Keep sensitive logs local.", style = MaterialTheme.typography.bodySmall) }
                    }
                    "Errors" -> {
                        WorkspaceHeader(!keyboardVisible) {
                            Choices(listOf("Default", "Redact message", "Custom").map { it to it }, draft.errorStrategy, "analytics-error-strategy") { draft = draft.copy(errorStrategy = it) }
                        }
                        if (draft.errorStrategy == "Custom") {
                            OutlinedTextField(draft.errorCallbackBody, { draft = draft.copy(errorCallbackBody = it) }, label = { UiText("Analytics error callback body") },
                                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), minLines = if (keyboardVisible) 2 else 3, maxLines = 4,
                                modifier = Modifier.fillMaxWidth().heightIn(min = if (keyboardVisible) 80.dp else 104.dp, max = 160.dp).testTag("analytics-error-body"))
                            UiText("input: {code, message, severity, originalErrorType}. Return a partial error or null.", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    "Default metadata" -> AnalyticsMetadataEditor("Default metadata", "analytics-default", analyticsDefaultKeys, draft.defaults,
                        state = editors.getOrPut("default") { AnalyticsMetadataState(analyticsDefaultKeys.first()) }) { draft = draft.copy(defaults = it) }
                    "Source metadata" -> AnalyticsMetadataEditor("Source / program metadata", "analytics-source", analyticsSourceKeys, draft.source,
                        state = editors.getOrPut("source") { AnalyticsMetadataState(analyticsSourceKeys.first()) }) { draft = draft.copy(source = it) }
                    "Runtime custom data" -> AnalyticsMetadataEditor("Runtime custom data", "analytics-custom", analyticsCustomKeys, custom,
                        state = editors.getOrPut("custom") { AnalyticsMetadataState(analyticsCustomKeys.first()) }) { custom = it }
                    "Runtime actions" -> {
                        WorkspaceHeading(actions.first { it.first == operation }.second)
                        UiText("Uses staged runtime/source metadata. Verify delivery in Bitmovin Dashboard.", style = MaterialTheme.typography.bodySmall)
                    }
                    "Code" -> SelectionContainer { Text(controller.apiAnalyticsSettings.code(), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, modifier = Modifier.testTag("analytics-code")) }
                }
                if (result.isNotEmpty()) SelectionContainer { Text(result, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("analytics-result")) }
            }
        }
        if (page !in listOf("SSAI", "Code", "Runtime actions", "Runtime custom data")) WorkspaceActions(
            if (draft == controller.apiAnalyticsSettings) "Analytics settings match the applied configuration." else "Unapplied Analytics changes. Apply recreates the player and reloads its source.",
            "analytics-reset", "analytics-apply", "Apply Analytics", enabled = draft != controller.apiAnalyticsSettings,
            reset = { draft = controller.apiAnalyticsSettings; editors.clear() },
            apply = { run { draft.playerConfig("validation-only"); controller.applyPlayerSettings(controller.playerSettings, controller.apiOverrides, draft) } })
        if (page == "Runtime actions") Surface(tonalElevation = 2.dp) {
            Button(onClick = { run {
                when (operation) {
                    "analytics-custom-event" -> requireNotNull(controller.player.analytics).sendCustomDataEvent(analyticsCustomData(custom))
                    "analytics-source-custom" -> { requireNotNull(controller.player.source?.analytics).customData = analyticsCustomData(custom) }
                    "analytics-program-change" -> requireNotNull(controller.player.analytics).programChange(draft.sourceMetadata())
                    else -> { val api = requireNotNull(controller.player.analytics); mapOf("impressionId" to api.impressionId, "userId" to api.userId, "sourceMetadata" to controller.player.source?.analytics?.metadata?.let(::analyticsMetadataValues)) }
                }
            } }, modifier = Modifier.fillMaxWidth().padding(12.dp).testTag(operation)) { UiText(actions.first { it.first == operation }.second) }
        }
    }
}

internal class AnalyticsMetadataState(initial: String) {
    var selected by mutableStateOf(initial)
    var inputs by mutableStateOf(emptyMap<String, String>())
    var error by mutableStateOf("")
}

@Composable
internal fun AnalyticsMetadataEditor(label: String, tag: String, keys: List<String>, values: Map<String, String>,
    state: AnalyticsMetadataState = remember { AnalyticsMetadataState(keys.first()) }, onChange: (Map<String, String>) -> Unit) {
    val selected = state.selected
    val input = state.inputs[selected] ?: values[selected].orEmpty()
    WorkspaceHeader(!workspaceKeyboardEditing()) {
        WorkspacePicker(label, selected, keys.map { it to it }, "$tag-field", searchable = true, compact = true) { state.selected = it; state.error = "" }
    }
    if (selected == "isLive") Choices(listOf("true", "false").map { it to it }, input, "$tag-choice") { state.inputs = state.inputs + (selected to it) }
    OutlinedTextField(input, { state.inputs = state.inputs + (selected to it) }, label = { UiText("Metadata value") }, modifier = Modifier.fillMaxWidth().testTag("$tag-value"))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = {
            runCatching { (values + (selected to input)).also { validateAnalyticsMetadata(it, keys) } }
                .onSuccess { onChange(it); state.error = "" }.onFailure { state.error = "Invalid metadata type or value. Your draft is retained." }
        }, modifier = Modifier.testTag("$tag-stage")) { UiText("Stage field") }
        OutlinedButton(onClick = { onChange(values - selected); state.inputs = state.inputs - selected; state.error = "" }, enabled = selected in values, modifier = Modifier.testTag("$tag-remove")) { UiText("Remove") }
    }
    UiText(if (selected in values) "This field has a staged value." else "This field uses its null or default value.", style = MaterialTheme.typography.bodySmall)
    UiText("Stage, then Apply or run the matching action.", style = MaterialTheme.typography.bodySmall)
    if (state.error.isNotEmpty()) UiText(state.error, color = MaterialTheme.colorScheme.error)
}
