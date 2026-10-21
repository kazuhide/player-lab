package com.playerlab.android

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun ConfigurationPanel(controller: PlayerController, uiMode: UiMode = UiMode.DEFAULT) {
    var expanded by remember { mutableStateOf(false) }
    var source by remember(controller.sourceRevision) { mutableStateOf(SourceDraft.from(controller.sourceSettings)) }
    var sourceErrors by remember(controller.sourceRevision) { mutableStateOf(emptyMap<String, String>()) }
    var sourceMessage by remember(controller.sourceRevision) { mutableStateOf("") }
    var player by remember(controller.playerSettings) { mutableStateOf(PlayerDraft.from(controller.playerSettings)) }
    var playerErrors by remember(controller.playerSettings) { mutableStateOf(emptyMap<String, String>()) }
    var playerMessage by remember(controller.playerSettings) { mutableStateOf("") }

    Button(onClick = { expanded = !expanded }, modifier = Modifier.testTag("configuration-toggle")) {
        Text(if (expanded) "Hide configuration" else "Configuration")
    }
    if (!expanded) return

    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("configuration-panel")) {
        Text("Draft changes take effect only after Apply.", style = MaterialTheme.typography.bodySmall)
        Text("Source", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        Text("Apply reloads the source in the current player. HTTP URLs require the device's network policy to permit cleartext.", style = MaterialTheme.typography.bodySmall)
        ConfigField("Source URL", source.url, { source = source.copy(url = it) }, "source-url", sourceErrors["url"], "HTTP or HTTPS stream URL")
        Text("Source type", style = MaterialTheme.typography.labelLarge)
        Choices(SourceType.entries.map { it to it.name }, source.type, "source-type") { source = source.copy(type = it) }
        ConfigField("Title", source.title, { source = source.copy(title = it) }, "source-title", helper = "Optional; blank uses the SDK default")
        ConfigField("Poster URL", source.posterUrl, { source = source.copy(posterUrl = it) }, "source-poster", sourceErrors["posterUrl"], "Optional HTTP or HTTPS image URL")
        ConfigToggle("Keep poster visible", source.posterPersistent, "source-poster-persistent") { source = source.copy(posterPersistent = it) }
        ConfigField("Start offset (s)", source.startOffset, { source = source.copy(startOffset = it) }, "source-offset", sourceErrors["startOffset"], "Blank = SDK default. Start uses positive seconds; End uses negative seconds. Out-of-window offsets are corrected by the SDK.")
        Text("Offset reference", style = MaterialTheme.typography.labelLarge)
        Choices(
            listOf(null to "SDK default", TimelineReferencePoint.Start to "Start", TimelineReferencePoint.End to "End"),
            source.offsetReference, "source-reference",
        ) { source = source.copy(offsetReference = it) }
        Text("The default reference is the start for VOD and the end for live streams.", style = MaterialTheme.typography.bodySmall)
        ConfigField(
            "Live target latency (s)", source.liveTargetLatency, { source = source.copy(liveTargetLatency = it) },
            "source-live-target", sourceErrors["liveTargetLatency"],
            "Blank keeps SDK defaults. An explicit value moves the SDK's live edge. The SDK tries to approach it while avoiding stalls, without a deadline guarantee. Ignored for VOD.",
            KeyboardType.Decimal,
        )
        ConfigField(
            "Source audio language priority", source.preferredAudioLanguages,
            { source = source.copy(preferredAudioLanguages = it) }, "source-audio-languages",
            sourceErrors["preferredAudioLanguages"],
            "Comma-separated codes, e.g. de, en. Blank inherits the player preference; a nonempty list overrides it. No match uses the default track.",
        )
        Text("External WebVTT subtitle", style = MaterialTheme.typography.titleSmall)
        ConfigField("WebVTT URL", source.subtitleUrl, { source = source.copy(subtitleUrl = it) },
            "source-subtitle-url", sourceErrors["subtitleUrl"], "Optional HTTP or HTTPS WebVTT file; blank adds no external track.")
        ConfigField("Subtitle label", source.subtitleLabel, { source = source.copy(subtitleLabel = it) },
            "source-subtitle-label", helper = "Optional name shown in the subtitle menu.")
        ConfigField("Subtitle language", source.subtitleLanguage, { source = source.copy(subtitleLanguage = it) },
            "source-subtitle-language", sourceErrors["subtitleLanguage"], "Optional language code, e.g. en or en-US.")
        ConfigToggle("Default external subtitle", source.subtitleDefault, "source-subtitle-default") {
            source = source.copy(subtitleDefault = it)
        }
        Text("Default is track metadata only. Enable subtitles with the player's subtitle menu; the SDK does not select them automatically.", style = MaterialTheme.typography.bodySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(onClick = {
                val validated = source.validate()
                sourceErrors = validated.errors
                sourceMessage = if (validated.value == null) "Correct the highlighted source fields." else ""
                validated.value?.let { controller.applySource(it) }
            }, modifier = Modifier.testTag("apply-source")) { Text("Apply source (reload)") }
            Button(onClick = {
                source = SourceDraft.from(controller.sourceSettings)
                sourceErrors = emptyMap()
                sourceMessage = "Source draft reset to the applied source."
            }, modifier = Modifier.testTag("reset-source")) { Text("Reset source draft") }
        }
        if (sourceMessage.isNotEmpty()) Text(sourceMessage, style = MaterialTheme.typography.bodySmall)

        Text("Player", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        Text("Apply restarts the player and reloads the current source, including its metadata and start offset. UI mode and Allow DVR are retained.", style = MaterialTheme.typography.bodySmall)
        ConfigToggle("Autoplay", player.autoplay, "config-autoplay") { player = player.copy(autoplay = it) }
        ConfigToggle("Start muted", player.muted, "config-muted") { player = player.copy(muted = it) }
        ConfigToggle("Enable SDK live time shifting", player.timeShift, "config-timeshift") { player = player.copy(timeShift = it) }
        ConfigField(
            "Player audio language priority", player.preferredAudioLanguages,
            { player = player.copy(preferredAudioLanguages = it) }, "config-audio-languages",
            playerErrors["preferredAudioLanguages"],
            "Comma-separated codes, highest priority first. Blank = no preference. A nonempty source preference takes precedence.",
        )
        Text("Buffer", style = MaterialTheme.typography.titleSmall)
        ConfigField("Startup threshold (s)", player.startupThreshold, { player = player.copy(startupThreshold = it) }, "config-startup", playerErrors["startupThreshold"], "Default 2.5; nonnegative and at most forward buffer minus 0.5", KeyboardType.Decimal)
        ConfigField("Restart threshold (s)", player.restartThreshold, { player = player.copy(restartThreshold = it) }, "config-restart", playerErrors["restartThreshold"], "Default 5; buffer needed after a stall", KeyboardType.Decimal)
        ConfigField("Forward buffer (s)", player.forwardDuration, { player = player.copy(forwardDuration = it) }, "config-forward", playerErrors["forwardDuration"], "Default 50; at least 0.5 for threshold headroom", KeyboardType.Decimal)
        Text("Adaptation", style = MaterialTheme.typography.titleSmall)
        ConfigField("Maximum automatic video bitrate (bps)", player.maxVideoBitrate, { player = player.copy(maxVideoBitrate = it) }, "config-max-bitrate", playerErrors["maxVideoBitrate"], "Blank = no ABR cap (2147483647). Higher qualities remain available for manual selection.", KeyboardType.Number)
        ConfigToggle("Preload content", player.preload, "config-preload") { player = player.copy(preload = it) }
        ConfigToggle("Allow rebuffering", player.rebuffering, "config-rebuffering") { player = player.copy(rebuffering = it) }
        ConfigField("Live quality / stability balance", player.qualityStabilityBalance, { player = player.copy(qualityStabilityBalance = it) }, "config-balance", playerErrors["qualityStabilityBalance"], "0 = quality; 1 = stability; default 0.5. Live streams near the live edge only.", KeyboardType.Decimal)
        Text("Network", style = MaterialTheme.typography.titleSmall)
        ConfigField(
            "HTTP retry delays (s)", player.httpRetryDelays, { player = player.copy(httpRetryDelays = it) },
            "config-http-retries", playerErrors["httpRetryDelays"],
            "Blank = SDK linear backoff. none = no retries. Otherwise enter finite nonnegative seconds, e.g. 0, 1, 2; one retry per value. Applies after player restart, not to DRM renewals by default.",
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(onClick = {
                val validated = player.validate()
                playerErrors = validated.errors
                playerMessage = if (validated.value == null) "Correct the highlighted player fields." else ""
                validated.value?.let { controller.applyPlayerSettings(it) }
            }, modifier = Modifier.testTag("apply-player")) { Text("Apply & restart player") }
            Button(onClick = {
                player = PlayerDraft()
                playerErrors = emptyMap()
                playerMessage = "Player draft reset to SDK defaults; Apply to restart."
            }, modifier = Modifier.testTag("reset-player")) { Text("Reset player draft") }
        }
        if (playerMessage.isNotEmpty()) Text(playerMessage, style = MaterialTheme.typography.bodySmall)
        if (controller.configurationStatus.isNotEmpty()) {
            Text(controller.configurationStatus, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("configuration-status"))
        }
        ConfigurationCodeView(controller, uiMode)
    }
}

@Composable
private fun ConfigField(
    label: String,
    value: String,
    change: (String) -> Unit,
    tag: String,
    error: String? = null,
    helper: String = "",
    keyboard: KeyboardType = KeyboardType.Text,
) {
    OutlinedTextField(
        value = value, onValueChange = change, label = { Text(label) }, singleLine = true,
        isError = error != null, supportingText = { Text(error ?: helper) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth().testTag(tag),
    )
}

@Composable
private fun ConfigToggle(label: String, checked: Boolean, tag: String, change: (Boolean) -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().testTag(tag).onFocusChanged { focused = it.isFocused }
            .toggleable(checked, role = Role.Switch, onValueChange = change)
            .then(if (focused) Modifier.border(2.dp, MaterialTheme.colorScheme.primary) else Modifier)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = null)
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun <T> Choices(choices: List<Pair<T, String>>, selected: T, tag: String, change: (T) -> Unit) {
    // Wrap narrow-screen choices instead of introducing another scroll axis inside the editor.
    // https://developer.android.com/develop/ui/compose/layouts/flow
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        choices.forEach { (value, label) ->
            Button(onClick = { change(value) }, enabled = selected != value, modifier = Modifier.testTag("$tag-$label")) { Text(label) }
        }
    }
}
