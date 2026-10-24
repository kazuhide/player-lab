package com.playerlab.android

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint

internal data class ConfigurationItem(val id: String, val label: String, val group: String)

internal val configurationItems = listOf(
    ConfigurationItem("source-url", "Stream URL", "Source"),
    ConfigurationItem("source-type", "Stream type", "Source"),
    ConfigurationItem("source-title", "Title", "Source"),
    ConfigurationItem("source-poster", "Poster image", "Source"),
    ConfigurationItem("source-poster-persistent", "Keep poster visible", "Source"),
    ConfigurationItem("source-offset", "Start position", "Source"),
    ConfigurationItem("source-reference", "Start position reference", "Source"),
    ConfigurationItem("source-live-target", "Live target latency", "Source"),
    ConfigurationItem("source-audio-languages", "Audio language priority", "Source"),
    ConfigurationItem("source-subtitle-url", "External subtitle URL", "Source"),
    ConfigurationItem("source-subtitle-label", "External subtitle label", "Source"),
    ConfigurationItem("source-subtitle-language", "External subtitle language", "Source"),
    ConfigurationItem("source-subtitle-default", "Default external subtitle", "Source"),
    ConfigurationItem("source-legacy-constructor", "Legacy source constructor", "Source"),
    ConfigurationItem("config-autoplay", "Autoplay", "Player"),
    ConfigurationItem("config-muted", "Start muted", "Player"),
    ConfigurationItem("config-timeshift", "Live time shifting", "Player"),
    ConfigurationItem("config-audio-languages", "Audio language priority", "Player"),
    ConfigurationItem("config-startup", "Startup buffer", "Player"),
    ConfigurationItem("config-restart", "Restart buffer", "Player"),
    ConfigurationItem("config-forward", "Forward buffer", "Player"),
    ConfigurationItem("config-max-bitrate", "Maximum automatic video bitrate", "Player"),
    ConfigurationItem("config-preload", "Preload content", "Player"),
    ConfigurationItem("config-rebuffering", "Allow rebuffering", "Player"),
    ConfigurationItem("config-balance", "Live quality and stability", "Player"),
    ConfigurationItem("config-http-retries", "HTTP retry delays", "Player"),
)

/** Held above workspace navigation, so changing category or tab cannot discard a draft. */
internal class ConfigurationWorkspaceState(sourceSettings: SourceSettings, playerSettings: PlayerSettings) {
    var source by mutableStateOf(SourceDraft.from(sourceSettings))
    var player by mutableStateOf(PlayerDraft.from(playerSettings))
    var sourceBase = sourceSettings
    var playerBase = playerSettings
    var group by mutableStateOf("Source")
    var selected by mutableStateOf("source-url")
    var sourceErrors by mutableStateOf(emptyMap<String, String>())
    var playerErrors by mutableStateOf(emptyMap<String, String>())
    var message by mutableStateOf("")
    fun select(id: String) {
        val item = configurationItems.first { it.id == id }
        group = item.group
        selected = id
    }
    fun synchronize(sourceSettings: SourceSettings, playerSettings: PlayerSettings) {
        if (source == SourceDraft.from(sourceBase)) source = SourceDraft.from(sourceSettings)
        if (player == PlayerDraft.from(playerBase)) player = PlayerDraft.from(playerSettings)
        sourceBase = sourceSettings
        playerBase = playerSettings
    }
}

@Composable
internal fun ConfigurationPanel(controller: PlayerController, state: ConfigurationWorkspaceState) {
    LaunchedEffect(controller.sourceRevision, controller.playerSettings) {
        state.synchronize(controller.sourceSettings, controller.playerSettings)
    }
    val isSource = state.group == "Source"
    val dirty = if (isSource) state.source != SourceDraft.from(controller.sourceSettings)
        else state.player != PlayerDraft.from(controller.playerSettings)
    val focus = LocalFocusManager.current
    val keyboardVisible = workspaceKeyboardEditing()
    Column(Modifier.fillMaxSize().testTag("configuration-panel")) {
        WorkspaceHeader(!keyboardVisible) { Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WorkspacePicker("Setting", state.selected, configurationItems.filter { it.group == state.group }.map { it.id to it.label },
                "configuration-setting", searchable = true) { state.select(it); focus.clearFocus() }
        } }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ConfigurationItemEditor(state)
            if (controller.configurationStatus.isNotEmpty()) UiText(controller.configurationStatus,
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("configuration-status"))
        }
        val detail = uiFormat(if (dirty) R.string.ui_draft_changed else R.string.ui_draft_matches,
            uiText(state.group).let { if (dirty) it.lowercase(java.util.Locale.ROOT) else it },
            uiText(if (isSource) "Reloads this source." else "Restarts player and source."))
        if (!keyboardVisible && state.message.isNotEmpty()) UiText(state.message, color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 12.dp).testTag("configuration-validation"))
        if (!keyboardVisible) UiText(if (isSource) uiFormat(R.string.ui_source_applied_summary, controller.sourceSettings.type.toString(),
            controller.sourceSettings.startOffset?.toString() ?: uiText("SDK default"), (controller.sourceSettings.externalSubtitle != null).toString())
            else uiFormat(R.string.ui_player_applied_summary, controller.playerSettings.autoplay.toString(), controller.playerSettings.muted.toString(), controller.playerSettings.forwardDuration.toString()),
            style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 12.dp).testTag("configuration-applied-summary"))
        WorkspaceActions(detail, if (isSource) "reset-source" else "reset-player", if (isSource) "apply-source" else "apply-player",
            if (isSource) "Apply source" else "Apply player",
            reset = {
                if (isSource) { state.source = SourceDraft.from(controller.sourceSettings); state.sourceErrors = emptyMap() }
                else { state.player = PlayerDraft.from(controller.playerSettings); state.playerErrors = emptyMap() }
                state.message = ""
                focus.clearFocus()
            }, apply = {
                focus.clearFocus()
                if (isSource) {
                    val validated = state.source.validate()
                    state.sourceErrors = validated.errors
                    if (validated.value == null) {
                        state.select(sourceErrorItem(validated.errors.keys.first()))
                        state.message = "Correct ${configurationItems.first { it.id == state.selected }.label.lowercase()}. Your draft is retained."
                    } else {
                        controller.applySource(validated.value)
                        if (controller.sourceSettings == validated.value) state.source = SourceDraft.from(controller.sourceSettings)
                        state.message = ""
                    }
                } else {
                    val validated = state.player.validate()
                    state.playerErrors = validated.errors
                    if (validated.value == null) {
                        state.select(playerErrorItem(validated.errors.keys.first()))
                        state.message = "Correct ${configurationItems.first { it.id == state.selected }.label.lowercase()}. Your draft is retained."
                    } else {
                        controller.applyPlayerSettings(validated.value)
                        if (controller.playerSettings == validated.value) state.player = PlayerDraft.from(controller.playerSettings)
                        state.message = ""
                    }
                }
            })
    }
}

internal fun sourceErrorItem(key: String): String = when (key) {
    "url" -> "source-url"; "posterUrl" -> "source-poster"; "startOffset" -> "source-offset"
    "liveTargetLatency" -> "source-live-target"; "preferredAudioLanguages" -> "source-audio-languages"
    "subtitleUrl" -> "source-subtitle-url"; "subtitleLanguage" -> "source-subtitle-language"; else -> "source-url"
}
internal fun playerErrorItem(key: String): String = when (key) {
    "startupThreshold" -> "config-startup"; "restartThreshold" -> "config-restart"; "forwardDuration" -> "config-forward"
    "maxVideoBitrate" -> "config-max-bitrate"; "qualityStabilityBalance" -> "config-balance"
    "httpRetryDelays" -> "config-http-retries"; "preferredAudioLanguages" -> "config-audio-languages"; else -> "config-autoplay"
}

@Composable
private fun ConfigurationItemEditor(state: ConfigurationWorkspaceState) {
    val source = state.source
    val player = state.player
    val se = state.sourceErrors
    val pe = state.playerErrors
    when (state.selected) {
        "source-url" -> ConfigField("Source URL", source.url, { state.source = source.copy(url = it) }, "source-url", se["url"], "HTTP or HTTPS URL.", KeyboardType.Uri)
        "source-type" -> WorkspacePicker("Source type", source.type, SourceType.entries.map { it to it.name }, "source-type") { state.source = source.copy(type = it) }
        "source-title" -> ConfigField("Title", source.title, { state.source = source.copy(title = it) }, "source-title", helper = "Blank uses the SDK default.")
        "source-poster" -> ConfigField("Poster URL", source.posterUrl, { state.source = source.copy(posterUrl = it) }, "source-poster", se["posterUrl"], "Optional HTTP or HTTPS image URL.", KeyboardType.Uri)
        "source-poster-persistent" -> ConfigToggle("Keep poster visible", source.posterPersistent, "source-poster-persistent") { state.source = source.copy(posterPersistent = it) }
        "source-offset" -> ConfigField("Start offset (s)", source.startOffset, { state.source = source.copy(startOffset = it) }, "source-offset", se["startOffset"], "Blank uses the SDK default. Start: positive seconds; End: negative seconds.", KeyboardType.Ascii)
        "source-reference" -> WorkspacePicker("Offset reference", source.offsetReference, listOf(null to "SDK default", TimelineReferencePoint.Start to "Start", TimelineReferencePoint.End to "End"), "source-reference") { state.source = source.copy(offsetReference = it) }
        "source-live-target" -> ConfigField("Live target latency (s)", source.liveTargetLatency, { state.source = source.copy(liveTargetLatency = it) }, "source-live-target", se["liveTargetLatency"], "Live only. Blank uses SDK defaults.", KeyboardType.Decimal)
        "source-audio-languages" -> ConfigField("Source audio language priority", source.preferredAudioLanguages, { state.source = source.copy(preferredAudioLanguages = it) }, "source-audio-languages", se["preferredAudioLanguages"], "Blank inherits player priority. Example: de, en.")
        "source-subtitle-url" -> ConfigField("WebVTT URL", source.subtitleUrl, { state.source = source.copy(subtitleUrl = it) }, "source-subtitle-url", se["subtitleUrl"], "Blank adds no external track.", KeyboardType.Uri)
        "source-subtitle-label" -> ConfigField("Subtitle label", source.subtitleLabel, { state.source = source.copy(subtitleLabel = it) }, "source-subtitle-label")
        "source-subtitle-language" -> ConfigField("Subtitle language", source.subtitleLanguage, { state.source = source.copy(subtitleLanguage = it) }, "source-subtitle-language", se["subtitleLanguage"], "For example en or en-US.")
        "source-subtitle-default" -> { ConfigToggle("Default external subtitle", source.subtitleDefault, "source-subtitle-default") { state.source = source.copy(subtitleDefault = it) }; UiText("Track metadata only. Enable subtitles in the player menu.", style = MaterialTheme.typography.bodySmall) }
        "source-legacy-constructor" -> {
            ConfigToggle("Use deprecated MediaSource constructor", source.useLegacyMediaSource, "source-legacy-constructor") { state.source = source.copy(useLegacyMediaSource = it) }
            UiText("Reloads using the matching legacy MediaSource.", style = MaterialTheme.typography.bodySmall)
        }
        "config-autoplay" -> ConfigToggle("Autoplay", player.autoplay, "config-autoplay") { state.player = player.copy(autoplay = it) }
        "config-muted" -> ConfigToggle("Start muted", player.muted, "config-muted") { state.player = player.copy(muted = it) }
        "config-timeshift" -> ConfigToggle("Enable SDK live time shifting", player.timeShift, "config-timeshift") { state.player = player.copy(timeShift = it) }
        "config-audio-languages" -> ConfigField("Player audio language priority", player.preferredAudioLanguages, { state.player = player.copy(preferredAudioLanguages = it) }, "config-audio-languages", pe["preferredAudioLanguages"], "Language codes in priority order. Example: de, en.")
        "config-startup" -> ConfigField("Startup threshold (s)", player.startupThreshold, { state.player = player.copy(startupThreshold = it) }, "config-startup", pe["startupThreshold"], "Default 2.5. Nonnegative and at most forward buffer minus 0.5.", KeyboardType.Decimal)
        "config-restart" -> ConfigField("Restart threshold (s)", player.restartThreshold, { state.player = player.copy(restartThreshold = it) }, "config-restart", pe["restartThreshold"], "Default 5. Buffer needed after a stall.", KeyboardType.Decimal)
        "config-forward" -> ConfigField("Forward buffer (s)", player.forwardDuration, { state.player = player.copy(forwardDuration = it) }, "config-forward", pe["forwardDuration"], "Default 50. At least 0.5 for threshold headroom.", KeyboardType.Decimal)
        "config-max-bitrate" -> ConfigField("Maximum automatic video bitrate (bps)", player.maxVideoBitrate, { state.player = player.copy(maxVideoBitrate = it) }, "config-max-bitrate", pe["maxVideoBitrate"], "Blank removes the automatic bitrate cap.", KeyboardType.Number)
        "config-preload" -> ConfigToggle("Preload content", player.preload, "config-preload") { state.player = player.copy(preload = it) }
        "config-rebuffering" -> ConfigToggle("Allow rebuffering", player.rebuffering, "config-rebuffering") { state.player = player.copy(rebuffering = it) }
        "config-balance" -> ConfigField("Live quality / stability balance", player.qualityStabilityBalance, { state.player = player.copy(qualityStabilityBalance = it) }, "config-balance", pe["qualityStabilityBalance"], "0 favors quality; 1 favors stability. Live playback near the live edge only.", KeyboardType.Decimal)
        "config-http-retries" -> ConfigField("HTTP retry delays (s)", player.httpRetryDelays, { state.player = player.copy(httpRetryDelays = it) }, "config-http-retries", pe["httpRetryDelays"], "Seconds, e.g. 0, 0.25, 2; none disables retries.")
    }
}

@Composable
internal fun ConfigField(label: String, value: String, change: (String) -> Unit, tag: String,
    error: String? = null, helper: String = "", keyboard: KeyboardType = KeyboardType.Text) {
    val focus = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val workspaceDone = LocalWorkspaceImeDone.current
    val fieldView = LocalView.current
    val editing = workspaceKeyboardEditing()
    OutlinedTextField(value, change, label = { UiText(label) }, singleLine = true,
        isError = error != null, supportingText = if (error != null || !editing && helper.isNotEmpty()) ({ UiText(error ?: helper) }) else null,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = {
            if (!workspaceDone(fieldView)) { focus.clearFocus(); keyboardController?.hide() }
        }),
        modifier = Modifier.fillMaxWidth().testTag(tag))
}

@Composable
internal fun ConfigToggle(label: String, checked: Boolean, tag: String, change: (Boolean) -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).onFocusChanged { focused = it.hasFocus }
        .toggleable(checked, role = Role.Switch, onValueChange = change)
        .border(if (focused) 2.dp else 1.dp, if (focused) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
            MaterialTheme.shapes.small)
        .padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        UiText(label, modifier = Modifier.weight(1f))
        Switch(checked, onCheckedChange = null)
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun <T> Choices(choices: List<Pair<T, String>>, selected: T, tag: String, change: (T) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        choices.forEach { (value, label) ->
            var focused by remember(value) { mutableStateOf(false) }
            FilterChip(selected == value, onClick = { change(value) }, label = { UiText(label) },
                leadingIcon = if (selected == value) ({ UiText("✓") }) else null,
                modifier = Modifier.heightIn(min = 48.dp).testTag("$tag-$label")
                    .onFocusChanged { focused = it.isFocused }
                    .then(if (focused) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.small) else Modifier))
        }
    }
}
