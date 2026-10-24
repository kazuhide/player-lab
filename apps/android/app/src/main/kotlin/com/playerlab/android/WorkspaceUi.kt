package com.playerlab.android

import android.content.res.Configuration
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val workspaceColors = lightColorScheme(
    primary = Color(0xFF005CB9), onPrimary = Color.White,
    primaryContainer = Color(0xFFE5EFFB), onPrimaryContainer = Color(0xFF003B76),
    secondary = Color(0xFF43566C), secondaryContainer = Color(0xFFE7EDF4),
    background = Color(0xFFF5F7FA), surface = Color.White,
    surfaceVariant = Color(0xFFEDF1F6), onSurface = Color(0xFF182333),
    onSurfaceVariant = Color(0xFF465569), outline = Color(0xFF6B7889),
    outlineVariant = Color(0xFFD2DAE4), surfaceTint = Color(0xFF005CB9),
    surfaceDim = Color(0xFFE7ECF2), surfaceBright = Color.White,
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF7F9FC),
    surfaceContainer = Color(0xFFF0F3F7), surfaceContainerHigh = Color(0xFFEAF0F6),
    surfaceContainerHighest = Color(0xFFE3EAF2),
)

@Composable
internal fun PlayerLabTheme(content: @Composable () -> Unit) {
    val typography = if (workspaceTelevision()) Typography(
        bodyLarge = MaterialTheme.typography.bodyLarge.copy(fontSize = 20.sp, lineHeight = 28.sp),
        bodyMedium = MaterialTheme.typography.bodyMedium.copy(fontSize = 18.sp, lineHeight = 24.sp),
        bodySmall = MaterialTheme.typography.bodySmall.copy(fontSize = 16.sp, lineHeight = 22.sp),
        titleMedium = MaterialTheme.typography.titleMedium.copy(fontSize = 22.sp, lineHeight = 28.sp),
        labelLarge = MaterialTheme.typography.labelLarge.copy(fontSize = 18.sp, lineHeight = 24.sp),
        labelMedium = MaterialTheme.typography.labelMedium.copy(fontSize = 16.sp, lineHeight = 22.sp),
        labelSmall = MaterialTheme.typography.labelSmall.copy(fontSize = 14.sp, lineHeight = 18.sp),
    ) else Typography()
    MaterialTheme(colorScheme = workspaceColors,
        typography = typography,
        shapes = Shapes(small = RoundedCornerShape(6.dp), medium = RoundedCornerShape(8.dp), large = RoundedCornerShape(12.dp)),
        content = content)
}

@Composable
internal fun workspaceTelevision(): Boolean =
    LocalConfiguration.current.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION

internal enum class WorkspaceTab(val label: String) { Settings("Settings"), APIs("APIs"), Code("Code"), More("More") }

internal val LocalWorkspaceSelectionChanged = staticCompositionLocalOf<() -> Unit> { {} }

@Composable
internal fun workspaceKeyboardEditing(): Boolean = WindowInsets.ime.getBottom(LocalDensity.current) > 0

/** Hide layout chrome during input without disposing a picker and its separate dialog window. */
@Composable
internal fun WorkspaceHeader(visible: Boolean, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().then(if (visible) Modifier else Modifier.clearAndSetSemantics { }
        .layout { _, _ -> layout(0, 0) { } })) { content() }
}

@Composable
internal fun WorkspaceNavigation(selected: WorkspaceTab, change: (WorkspaceTab) -> Unit) {
    Surface(tonalElevation = 2.dp) {
        Row(Modifier.fillMaxWidth().testTag("workspace-navigation")) {
            WorkspaceTab.entries.forEach { tab ->
                var focused by remember { mutableStateOf(false) }
                TextButton(onClick = { change(tab) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                    .testTag("workspace-${tab.name.lowercase()}")
                    .onFocusChanged { focused = it.isFocused }
                    .then(if (focused) Modifier.border(2.dp, MaterialTheme.colorScheme.primary) else Modifier)
                    .semantics { this.selected = selected == tab },
                    shape = RoundedCornerShape(0.dp),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = if (selected == tab) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        containerColor = if (selected == tab) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        UiText(tab.label, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            fontWeight = if (selected == tab) FontWeight.SemiBold else FontWeight.Normal)
                        Box(Modifier.width(24.dp).height(2.dp).then(if (selected == tab)
                            Modifier.border(1.dp, MaterialTheme.colorScheme.primary) else Modifier))
                    }
                }
            }
        }
    }
}

@Composable
internal fun WorkspaceSections(values: List<String>, selected: String, tag: String, change: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        values.forEach { value ->
            var focused by remember { mutableStateOf(false) }
            TextButton(onClick = { change(value) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                .onFocusChanged { focused = it.isFocused }
                .then(if (focused) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.small) else Modifier)
                .testTag("$tag-$value").semantics { this.selected = selected == value },
                shape = MaterialTheme.shapes.small,
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
                colors = ButtonDefaults.textButtonColors(
                    contentColor = if (selected == value) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    containerColor = if (selected == value) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)) {
                UiText(value, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    fontWeight = if (selected == value) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}

/** Keeps in-memory drafts alive without measuring, displaying or exposing inactive pages. */
@Composable
internal fun RetainedWorkspacePage(active: Boolean, composeInitially: Boolean = false, content: @Composable () -> Unit) {
    var visited by remember { mutableStateOf(active || composeInitially) }
    if (active) visited = true
    if (!visited) return
    Box(Modifier.fillMaxSize().then(if (active) Modifier else Modifier
        .clearAndSetSemantics { }
        .focusProperties { canFocus = false }
        .layout { _, _ -> layout(0, 0) { } })) { content() }
}

@Composable
internal fun WorkspaceHeading(title: String, detail: String? = null) {
    UiText(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
    detail?.let { UiText(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
}

/** A selection dialog keeps the editor and its actions in place, even for the full SDK catalogue. */
@Composable
internal fun <T> WorkspacePicker(
    label: String,
    selected: T,
    choices: List<Pair<T, String>>,
    tag: String,
    searchable: Boolean = false,
    compact: Boolean = false,
    modifier: Modifier = Modifier,
    selectedLabel: String? = null,
    change: (T) -> Unit,
) {
    val selectionChanged = LocalWorkspaceSelectionChanged.current
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var focused by remember { mutableStateOf(false) }
    val current = selectedLabel ?: choices.firstOrNull { it.first == selected }?.second ?: selected.toString()
    OutlinedButton(onClick = { query = ""; open = true }, modifier = modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag)
        .onFocusChanged { focused = it.isFocused }
        .then(if (focused) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.small) else Modifier),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface,
            containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.small, contentPadding = PaddingValues(horizontal = 12.dp, vertical = if (compact) 6.dp else 8.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (compact) 0.dp else 2.dp)) {
            UiText(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            UiText(current, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium,
                maxLines = if (compact) 1 else 2, overflow = TextOverflow.Ellipsis)
        }
        UiText("⌄", modifier = Modifier.padding(start = 8.dp))
    }
    if (open) AlertDialog(
        onDismissRequest = { open = false },
        title = { UiText(label) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (searchable) OutlinedTextField(query, { query = it }, label = { UiText(uiFormat(R.string.ui_picker_search, uiText(label))) },
                    singleLine = true, modifier = Modifier.fillMaxWidth().testTag("$tag-search"))
                val localizedChoices = choices.map { (value, title) -> Triple(value, title, uiText(title)) }
                val matches = localizedChoices.filter { (value, title, localized) -> localized.contains(query, ignoreCase = true) || title.contains(query, ignoreCase = true) || value.toString().contains(query, ignoreCase = true) }
                if (matches.isEmpty()) UiText("No matching items. Change the search text.")
                LazyColumn(Modifier.heightIn(max = 360.dp).testTag("$tag-options")) {
                    items(matches) { (value, _, title) ->
                        var optionFocused by remember(value) { mutableStateOf(false) }
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("$tag-option-${value}")
                            .onFocusChanged { optionFocused = it.isFocused }
                            .then(if (optionFocused) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.small) else Modifier)
                            .selectable(selected == value, role = Role.RadioButton, onClick = { selectionChanged(); change(value); open = false })
                            .padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected == value, onClick = null)
                            UiText(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { open = false }) { UiText("Close") } },
    )
}

/** Keep raw SDK values selectable and visually separate from app labels. */
@Composable
internal fun WorkspaceReadout(title: String, value: String, tag: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = MaterialTheme.shapes.small,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            UiText(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SelectionContainer { Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag(tag)) }
        }
    }
}

@Composable
internal fun WorkspaceActions(detail: String, resetTag: String, applyTag: String, applyLabel: String,
    enabled: Boolean = true, reset: () -> Unit, apply: () -> Unit) {
    val keyboardVisible = workspaceKeyboardEditing()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth().testTag("workspace-actions")) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            UiText(detail, style = MaterialTheme.typography.bodySmall, maxLines = if (keyboardVisible) 1 else 2,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("workspace-draft-status"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = { focus.clearFocus(); keyboard?.hide(); reset() }, modifier = Modifier.testTag(resetTag)) { UiText("Reset draft") }
                Button(onClick = { focus.clearFocus(); keyboard?.hide(); apply() }, enabled = enabled, modifier = Modifier.weight(1f).testTag(applyTag)) { UiText(applyLabel) }
            }
        }
    }
}

internal fun apiDisplayName(id: String): String = id.removePrefix("android:com.bitmovin.player.api.")
    .removePrefix("android:com.bitmovin.player.").removePrefix("com.bitmovin.player.api.")

internal fun apiPurpose(id: String): String {
    val value = id.lowercase()
    return when {
        "analytics" in value -> "Analytics"
        "offline" in value || "download" in value -> "Offline"
        "advertis" in value || "ssai" in value || "ima" in value || "aditem" in value || "adconfig" in value -> "Advertising"
        "drm" in value || "widevine" in value || "clearkey" in value -> "Content protection"
        "network" in value || "http" in value || "retry" in value -> "Network"
        "subtitle" in value || "audio" in value || "caption" in value -> "Audio and subtitles"
        "vr" in value || "orientation" in value || "viewingdirection" in value || "vector3" in value -> "VR"
        "casting" in value || "remotecontrol" in value || "cast" in value -> "Casting"
        "playerview" in value || "uiconfig" in value || "scaling" in value || "surface" in value -> "UI and display"
        "live" in value || "timeshift" in value || "latency" in value -> "Live playback"
        "buffer" in value || "adaptation" in value || "quality" in value || "bitrate" in value -> "Buffer and quality"
        "source" in value || "playlist" in value -> "Sources and playlist"
        else -> "Playback"
    }
}
