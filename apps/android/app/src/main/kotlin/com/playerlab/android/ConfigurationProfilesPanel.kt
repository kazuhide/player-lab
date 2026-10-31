package com.playerlab.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Profile operations only read or edit app drafts. This panel has no PlayerController reference. */
@Composable
internal fun ConfigurationProfilesPanel(configuration: ConfigurationWorkspaceState, overrides: ApiConfigurationWorkspaceState) {
    val context = LocalContext.current
    val repository = remember(context.applicationContext) {
        ConfigurationProfileRepository(AndroidConfigurationProfileStorage(context), BuildConfig.PLAYER_SDK_VERSION)
    }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var profiles by remember { mutableStateOf(emptyList<ConfigurationProfile>()) }
    var selected by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(true) }
    var loadFailed by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var replace by remember { mutableStateOf<ConfigurationProfile?>(null) }
    var restore by remember { mutableStateOf<ConfigurationProfile?>(null) }
    var deleting by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    var help by remember { mutableStateOf(false) }
    fun failure(failure: Throwable) { if (failure is CancellationException) throw failure; error = (failure as? ConfigurationProfileException)?.problem?.text ?: ConfigurationProfileProblem.Storage.text; message = "" }
    LaunchedEffect(repository) {
        runCatching { withContext(Dispatchers.IO) { repository.list() } }
            .onSuccess { profiles = it; loadFailed = false }
            .onFailure { failure(it); loadFailed = true }
        busy = false
    }
    fun save(profile: ConfigurationProfile, replacing: Boolean = false) {
        if (busy) return
        busy = true; error = ""; message = ""; focus.clearFocus()
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { repository.save(profile, replacing) } }
                .onSuccess { profiles = it; selected = profile.name; name = profile.name; message = "Profile saved." }
                .onFailure(::failure)
            busy = false
        }
    }
    fun restoreDraft(profile: ConfigurationProfile, confirmed: Boolean = false) {
        runCatching { ConfigurationProfiles.restore(profile, BuildConfig.PLAYER_SDK_VERSION, configuration, overrides, confirmed) }
            .onSuccess { error = ""; message = "Loaded into drafts. Playback is unchanged." }
            .onFailure(::failure)
        focus.clearFocus()
    }
    val chosen = profiles.firstOrNull { it.name == selected }
    Column(Modifier.fillMaxSize().testTag("configuration-profiles")) {
        WorkspaceHeader(!workspaceKeyboardEditing()) {
            WorkspacePicker("Saved profile", selected, listOf("" to uiText("Choose a profile")) + profiles.map { it.name to it.name },
                "profile-selector", compact = true, translateChoices = false, enabled = !busy && !loadFailed, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                selected = it; name = it; error = ""; message = ""; focus.clearFocus()
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(name, { if (it.length <= 192) name = it; error = ""; message = "" },
                label = { UiText("Profile name") }, singleLine = true, enabled = !busy && !loadFailed,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
                modifier = Modifier.fillMaxWidth().testTag("profile-name"))
            chosen?.let { UiText(uiFormat(R.string.ui_profile_sdk_version, it.sdkVersion), style = MaterialTheme.typography.labelSmall) }
            UiText("Restores drafts only. Review and Apply each section.", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { help = true }, modifier = Modifier.testTag("profile-saved-fields")) { UiText("Saved fields") }
            if (profiles.isEmpty() && !busy && !loadFailed) UiText("No saved profiles.", style = MaterialTheme.typography.bodySmall)
            if (loadFailed) TextButton(onClick = { clearing = true }, enabled = !busy, modifier = Modifier.testTag("profile-clear")) { UiText("Delete saved profiles") }
        }
        if (error.isNotEmpty()) UiText(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 12.dp).testTag("profile-error"))
        if (message.isNotEmpty()) UiText(message, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 12.dp).testTag("profile-status"))
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                runCatching { ConfigurationProfiles.capture(name, BuildConfig.PLAYER_SDK_VERSION, configuration.source, configuration.player, overrides.values) }
                    .onSuccess { profile -> if (profiles.any { ConfigurationProfiles.sameName(it.name, profile.name) }) replace = profile else save(profile) }
                    .onFailure(::failure)
            }, enabled = !busy && !loadFailed && name.isNotBlank(), modifier = Modifier.weight(1f).testTag("profile-save")) { UiText("Save profile") }
            OutlinedButton(onClick = { chosen?.let { if (it.sdkVersion != BuildConfig.PLAYER_SDK_VERSION) restore = it else restoreDraft(it) } },
                enabled = !busy && chosen != null, modifier = Modifier.weight(1f).testTag("profile-restore")) { UiText("Load draft") }
        }
        TextButton(onClick = { deleting = true }, enabled = !busy && chosen != null,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).testTag("profile-delete")) { UiText("Delete profile") }
    }
    if (help) AlertDialog(onDismissRequest = { help = false }, title = { UiText("Saved fields") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            UiText("Saves standard Player and Source settings and supported numeric, boolean and enum SDK overrides. Only built-in stream IDs are saved.")
            UiText("Custom URLs, titles, posters, subtitles, credentials, headers, metadata, Analytics settings and scripts are excluded. Other SDK overrides and the theme selector are not saved.")
            UiText("Excluded fields retain their current draft values when a profile is loaded. Review Source, Player and SDK overrides before using their Apply actions.")
            UiText("Profiles stay on this device and survive app restarts. Up to 20 profiles; names up to 48 characters. There is no export or automatic playback.")
        } }, confirmButton = { TextButton(onClick = { help = false }) { UiText("Close") } })
    replace?.let { profile -> AlertDialog(onDismissRequest = { replace = null }, title = { UiText("Replace saved profile?") },
        text = { Text(profile.name) }, confirmButton = { TextButton(onClick = { replace = null; save(profile, true) }, modifier = Modifier.testTag("profile-replace-confirm")) { UiText("Replace") } },
        dismissButton = { TextButton(onClick = { replace = null }) { UiText("Cancel") } }) }
    restore?.let { profile -> AlertDialog(onDismissRequest = { restore = null }, title = { UiText("Different SDK version") },
        text = { UiText(uiFormat(R.string.ui_profile_sdk_warning, profile.sdkVersion, BuildConfig.PLAYER_SDK_VERSION)) },
        confirmButton = { TextButton(onClick = { restore = null; restoreDraft(profile, true) }, modifier = Modifier.testTag("profile-sdk-confirm")) { UiText("Load draft") } },
        dismissButton = { TextButton(onClick = { restore = null }) { UiText("Cancel") } }) }
    if (deleting || clearing) AlertDialog(onDismissRequest = { deleting = false; clearing = false }, title = { UiText(if (clearing) "Delete saved profiles?" else "Delete profile?") },
        text = { UiText(if (clearing) "Saved profiles will be removed. Current drafts and playback are unchanged." else "The selected saved profile will be removed. Current drafts and playback are unchanged.") },
        confirmButton = { TextButton(onClick = {
            val all = clearing; val target = selected; deleting = false; clearing = false
            busy = true; error = ""; message = ""
            scope.launch {
                runCatching { withContext(Dispatchers.IO) { if (all) { repository.clear(); emptyList() } else repository.delete(target) } }
                    .onSuccess { profiles = it; selected = ""; name = ""; loadFailed = false; message = "Profile deleted." }
                    .onFailure(::failure)
                busy = false
            }
        }, modifier = Modifier.testTag("profile-delete-confirm")) { UiText("Delete") } },
        dismissButton = { TextButton(onClick = { deleting = false; clearing = false }) { UiText("Cancel") } })
}
