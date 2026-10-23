package com.playerlab.android

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import com.bitmovin.player.api.offline.DeviceStateRequirement
import com.bitmovin.player.api.offline.OfflineContentManager
import com.bitmovin.player.api.offline.options.OfflineOptionEntryAction
import com.bitmovin.player.api.source.SourceType

@Composable
internal fun ApiOfflinePanel(controller: PlayerController) {
    val offline = controller.apiOffline
    var page by remember { mutableStateOf("Manager") }
    var setting by remember { mutableStateOf("Downloads") }
    var requirement by remember { mutableStateOf(DeviceStateRequirement.entries.first()) }
    var factorySetting by remember { mutableStateOf("DRM ID") }
    var operation by remember { mutableStateOf("offline-options") }
    var id by remember { mutableStateOf("sample-vod") }
    var draft by remember { mutableStateOf(ApiOfflineConfigDraft()) }
    var appliedDraft by remember { mutableStateOf(draft) }
    var appliedCode by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    var selectedTrack by remember { mutableStateOf("") }
    var sourceDraft by remember { mutableStateOf(ApiOfflineSourceDraft()) }
    var sourceFactoryCode by remember { mutableStateOf("") }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        result = if (allowed) "Download notifications enabled." else "Download notifications are disabled in system settings."
    }
    fun run(action: () -> Any?) {
        result = runCatching { apiResultText(controller.hostContext, action()) }.getOrElse { controller.hostContext.getString(R.string.ui_offline_api_failed, it.javaClass.simpleName) }
    }
    val actions = listOf(
        "offline-options" to "Fetch SDK track options", "offline-suspend" to "Suspend downloads", "offline-resume" to "Resume downloads",
        "offline-play" to "Play downloaded source", "offline-delete" to "Delete all content for this ID",
        "offline-license-download" to "Download offline DRM license", "offline-license-renew" to "Renew offline DRM license",
        "offline-license-release" to "Release offline DRM license", "offline-release" to "Release manager",
        "offline-state" to "Read offline SDK state", "offline-config-read" to "Read applied offline configuration",
    )
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(!workspaceKeyboardEditing()) { Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WorkspacePicker("Offline", page, listOf("Manager", "Download settings", "Track selection", "Offline source", "Actions", "Code").map { it to it }, "offline-page", compact = true) { page = it }
            when (page) {
                "Download settings" -> WorkspacePicker("Setting", setting, listOf("Downloads", "Segments", "Device requirements", "DRM license handling").map { it to it }, "offline-setting", compact = true) { setting = it }
                "Offline source" -> WorkspacePicker("Setting", factorySetting, listOf("DRM ID", "Offline restriction", "Cache directory", "Track-state file").map { it to it }, "offline-factory-setting", compact = true) { factorySetting = it }
                "Actions" -> WorkspacePicker("Operation", operation, actions, "offline-action-selector", compact = true) { operation = it }
                "Track selection" -> {
                    val revision = offline.revision
                    val entries = remember(offline.options, revision) { offline.entries() }
                    if (entries.isNotEmpty()) WorkspacePicker("Track", selectedTrack.ifBlank { entries.first().first },
                        entries.map { (key, entry) -> key to "$key ${entry.language.orEmpty()} ${entry.codecs.orEmpty()}" },
                        "offline-track-selector", searchable = true, compact = true) { selectedTrack = it }
                }
            }
        } }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (page) {
                "Manager" -> {
                    ConfigField("Stable content ID", id, { id = it }, "offline-content-id")
                    WorkspaceHeading("Offline downloads", "Use downloadable video on demand. Files remain when a manager is released; Delete all removes them.")
                    if (Build.VERSION.SDK_INT >= 33) OutlinedButton(onClick = { permission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { UiText("Allow download notifications") }
                    OutlinedButton(onClick = { controller.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/manifest.mpd", SourceType.Dash)) }, modifier = Modifier.testTag("offline-use-sample")) { UiText("Use sample DASH source") }
                    UiText(uiFormat(R.string.ui_current_source_type, controller.sourceSettings.type.toString()), style = MaterialTheme.typography.bodySmall)
                }
                "Download settings" -> when (setting) {
                    "Downloads" -> ConfigField("Maximum simultaneous downloads", draft.downloads, { draft = draft.copy(downloads = it) }, "offline-config-downloads")
                    "Segments" -> ConfigField("Maximum simultaneous segment downloads", draft.segments, { draft = draft.copy(segments = it) }, "offline-config-segments")
                    "Device requirements" -> {
                        WorkspacePicker("Device requirement", requirement, DeviceStateRequirement.entries.map { it to it.name }, "offline-requirement-selector", compact = true) { requirement = it }
                        ConfigToggle(requirement.name, requirement in draft.requirements, "offline-requirement-${requirement.name}") { selected ->
                            draft = draft.copy(requirements = if (selected) draft.requirements + requirement else draft.requirements - requirement)
                        }
                        UiText("Downloads wait until every selected device requirement is met.", style = MaterialTheme.typography.bodySmall)
                    }
                    "DRM license handling" -> ConfigToggle("Automatically handle offline DRM licenses", draft.automaticDrm, "offline-config-automatic-drm") { draft = draft.copy(automaticDrm = it) }
                }
                "Offline source" -> {
                    when (factorySetting) {
                        "DRM ID" -> OutlinedTextField(sourceDraft.drmIdHex, { sourceDraft = sourceDraft.copy(drmIdHex = it) }, label = { UiText("drmId: hexadecimal bytes or null") }, visualTransformation = PasswordVisualTransformation(), supportingText = { UiText("Offline session key-set ID, not a Player key.") }, modifier = Modifier.fillMaxWidth().testTag("offline-factory-drm"))
                        "Offline restriction" -> ConfigToggle("Restrict playback to cached content", sourceDraft.restrictToOffline, "offline-factory-restrict") { sourceDraft = sourceDraft.copy(restrictToOffline = it) }
                        "Cache directory" -> ConfigField("Cache directory name", sourceDraft.cacheFolder, { sourceDraft = sourceDraft.copy(cacheFolder = it) }, "offline-factory-cache")
                        "Track-state file" -> ConfigField("Track-state file name", sourceDraft.trackStateFile, { sourceDraft = sourceDraft.copy(trackStateFile = it) }, "offline-factory-tracks")
                    }
                    UiText("Advanced constructor for the current URL and type. It uses named directories in this app's private api-offline-source storage and does not copy SDK-managed downloads. Restriction requires matching cached resources and track state. Usually use Play downloaded source.", style = MaterialTheme.typography.bodySmall)
                }
                "Track selection" -> {
                    val revision = offline.revision
                    val entries = remember(offline.options, revision) { offline.entries() }
                    val selected = entries.firstOrNull { it.first == selectedTrack } ?: entries.firstOrNull()
                    if (selected == null) UiText("No options received. Use Actions > Fetch SDK track options after creating a manager.")
                    else {
                        val (key, entry) = selected
                        Choices(listOf(null to "None", OfflineOptionEntryAction.Download to "Download", OfflineOptionEntryAction.Delete to "Delete"), entry.action, "offline-action-$key") { action -> run { offline.setAction(key, action) } }
                        SelectionContainer { Text(apiValue(offlineEntrySummary(entry)), style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("offline-option-$key")) }
                        UiText("Stage Download, Delete or None for this track. Process applies all selected track actions. The SDK may reject actions incompatible with track state.", style = MaterialTheme.typography.bodySmall)
                    }
                }
                "Actions" -> {
                    WorkspaceHeading(actions.first { it.first == operation }.second)
                    UiText(when {
                        operation == "offline-delete" -> "Permanently removes downloaded files for the current content ID."
                        "license" in operation -> "Requires an offline-capable DRM source and license."
                        operation == "offline-release" -> "Releases this manager and keeps downloaded files."
                        else -> "Targets the current offline manager and source."
                    }, style = MaterialTheme.typography.bodySmall)
                }
                "Code" -> {
                    SelectionContainer { Text(appliedCode.ifEmpty { "// No offline configuration applied in this session." },
                        fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("offline-config-code")) }
                    SelectionContainer { Text(sourceFactoryCode.ifEmpty { "// No advanced offline source constructed in this session." },
                        fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("offline-factory-code")) }
                }
            }
            UiText(offline.status, modifier = Modifier.testTag("offline-status"), style = MaterialTheme.typography.bodySmall)
            UiText(uiFormat(R.string.ui_progress, offline.progress.toString()), style = MaterialTheme.typography.bodySmall)
            if (result.isNotEmpty()) SelectionContainer { Text(result, modifier = Modifier.testTag("offline-result"), style = MaterialTheme.typography.bodySmall) }
        }
        when (page) {
            "Download settings" -> WorkspaceActions(if (draft == appliedDraft) "Download settings match the applied draft." else "Unapplied download settings.", "offline-config-reset", "offline-config-apply", "Apply offline settings",
                reset = { draft = appliedDraft }, apply = { run { offline.applyConfig(draft.build()); appliedCode = draft.code(); appliedDraft = draft } })
            "Manager" -> FixedOfflineAction("offline-create", "Create manager", true) { run { controller.createOfflineManager(id) } }
            "Offline source" -> FixedOfflineAction("offline-factory-apply", "Construct and load source", true) { run {
                val config = sourceDraft.build(controller.hostContext, controller.sourceSettings.toSourceConfig())
                controller.loadOfflineSource(config); sourceFactoryCode = sourceDraft.code()
                mapOf("constructed" to true, "isRestrictToOffline" to config.isRestrictToOffline, "drmIdBytes" to config.drmId?.size)
            } }
            "Track selection" -> FixedOfflineAction("offline-process", "Process selected actions", offline.options != null) { run { offline.process() } }
            "Actions" -> FixedOfflineAction(operation, actions.first { it.first == operation }.second, offline.manager != null || operation == "offline-config-read") { run {
                when (operation) {
                    "offline-options" -> offline.getOptions()
                    "offline-suspend" -> offline.requireManager().suspend()
                    "offline-resume" -> offline.requireManager().resume()
                    "offline-play" -> controller.loadOfflineSource(requireNotNull(offline.requireManager().offlineSourceConfig))
                    "offline-delete" -> offline.requireManager().deleteAll()
                    "offline-license-download" -> offline.requireManager().downloadLicense()
                    "offline-license-renew" -> offline.requireManager().renewOfflineLicense()
                    "offline-license-release" -> offline.requireManager().releaseLicense()
                    "offline-release" -> offline.releaseManager()
                    "offline-state" -> {
                        val manager = offline.requireManager()
                        val license = runCatching { manager.remainingOfflineLicenseDuration }.getOrNull()
                        val source = manager.offlineSourceConfig
                        mapOf("usedStorage" to manager.usedStorage, "offlineSourceConfig" to source?.let { mapOf("type" to it.type, "isRestrictToOffline" to it.isRestrictToOffline, "drmIdBytes" to it.drmId?.size) }, "licenseDuration" to license?.licenseDuration, "playbackDuration" to license?.playbackDuration)
                    }
                    "offline-config-read" -> {
                        val config = OfflineContentManager.offlineConfig
                        mapOf("maxSimultaneousDownloads" to config.maxSimultaneousDownloads, "maxSimultaneousSegmentDownloads" to config.maxSimultaneousSegmentDownloads,
                            "deviceStateRequirements" to config.deviceStateRequirements.map { it.name }, "requirements" to config.requirements.requirements,
                            "shouldAutomaticallyHandleDrmLicenses" to config.tweaksConfig.shouldAutomaticallyHandleDrmLicenses)
                    }
                    else -> error("Select an offline operation.")
                }
            } }
        }
    }
}

@Composable
private fun FixedOfflineAction(tag: String, label: String, enabled: Boolean, action: () -> Unit) {
    Surface(tonalElevation = 2.dp) { Button(action, enabled = enabled, modifier = Modifier.fillMaxWidth().padding(12.dp).testTag(tag)) { UiText(label) } }
}
