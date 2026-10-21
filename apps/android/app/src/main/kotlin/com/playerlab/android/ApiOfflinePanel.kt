package com.playerlab.android

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bitmovin.player.api.offline.DeviceStateRequirement
import com.bitmovin.player.api.offline.OfflineContentManager
import com.bitmovin.player.api.offline.options.OfflineOptionEntryAction
import com.bitmovin.player.api.source.SourceType

@Composable
internal fun ApiOfflinePanel(controller: PlayerController) {
    val offline = controller.apiOffline
    var expanded by remember { mutableStateOf(false) }
    var id by remember { mutableStateOf("sample-vod") }
    var draft by remember { mutableStateOf(ApiOfflineConfigDraft()) }
    var appliedCode by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        result = if (allowed) "Download notifications enabled." else "Download notifications are disabled in system settings."
    }
    fun run(action: () -> Any?) {
        result = runCatching { apiValue(action()) }.getOrElse { "Offline API failed (${it.javaClass.simpleName}). Check source, selection, storage and SDK events." }
    }
    Button(onClick = { expanded = !expanded }, modifier = Modifier.testTag("offline-toggle")) {
        Text(if (expanded) "Hide offline controls" else "Offline controls")
    }
    if (!expanded) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Offline downloads and playback", style = MaterialTheme.typography.titleMedium)
        Text("Use a downloadable video-on-demand source. Downloads use device storage and can continue in the SDK service. Releasing a manager keeps its files; Delete all removes them. License operations require an offline-capable DRM source and license.", style = MaterialTheme.typography.bodySmall)
        if (Build.VERSION.SDK_INT >= 33) Button(onClick = { permission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow download notifications") }
        Button(onClick = { controller.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/manifest.mpd", SourceType.Dash)) }, modifier = Modifier.testTag("offline-use-sample")) { Text("Use sample DASH source") }
        Text("Player source: ${controller.sourceSettings.type}", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(id, { id = it }, label = { Text("Stable content ID") }, modifier = Modifier.fillMaxWidth().testTag("offline-content-id"), singleLine = true)
        Button(onClick = { run { controller.createOfflineManager(id) } }, modifier = Modifier.testTag("offline-create")) { Text("Create manager for current source") }

        Text("Download service configuration", style = MaterialTheme.typography.titleSmall)
        OutlinedTextField(draft.downloads, { draft = draft.copy(downloads = it) }, label = { Text("maxSimultaneousDownloads") }, modifier = Modifier.fillMaxWidth().testTag("offline-config-downloads"), singleLine = true)
        OutlinedTextField(draft.segments, { draft = draft.copy(segments = it) }, label = { Text("maxSimultaneousSegmentDownloads") }, modifier = Modifier.fillMaxWidth().testTag("offline-config-segments"), singleLine = true)
        Text("deviceStateRequirements (downloads wait until every selected requirement is met)", style = MaterialTheme.typography.bodySmall)
        DeviceStateRequirement.entries.forEach { requirement ->
            Row {
                Checkbox(requirement in draft.requirements, { selected -> draft = draft.copy(requirements = if (selected) draft.requirements + requirement else draft.requirements - requirement) }, modifier = Modifier.testTag("offline-requirement-${requirement.name}"))
                Text(requirement.name)
            }
        }
        Row {
            Switch(draft.automaticDrm, { draft = draft.copy(automaticDrm = it) }, modifier = Modifier.testTag("offline-config-automatic-drm"))
            Text("Automatically handle offline DRM licenses")
        }
        Button(onClick = { run { offline.applyConfig(draft.build()); appliedCode = draft.code() } }, modifier = Modifier.testTag("offline-config-apply")) { Text("Apply offline configuration") }
        if (appliedCode.isNotEmpty()) SelectionContainer { Text(appliedCode, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("offline-config-code")) }
        Button(onClick = { run {
            val config = OfflineContentManager.offlineConfig
            mapOf("maxSimultaneousDownloads" to config.maxSimultaneousDownloads, "maxSimultaneousSegmentDownloads" to config.maxSimultaneousSegmentDownloads,
                "deviceStateRequirements" to config.deviceStateRequirements.map { it.name }, "requirements" to config.requirements.requirements,
                "shouldAutomaticallyHandleDrmLicenses" to config.tweaksConfig.shouldAutomaticallyHandleDrmLicenses)
        } }, modifier = Modifier.testTag("offline-config-read")) { Text("Read applied offline configuration") }

        Text("Content options", style = MaterialTheme.typography.titleSmall)
        Button(onClick = { run { offline.getOptions() } }, enabled = offline.manager != null, modifier = Modifier.testTag("offline-options")) { Text("Fetch SDK options") }
        Text("Set each track action to Download, Delete or None. The SDK can reject actions that do not fit the current track state. Nothing is selected automatically.", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(query, { query = it }, label = { Text("Find track ID, type, language or codec") }, modifier = Modifier.fillMaxWidth().testTag("offline-options-search"), singleLine = true)
        // revision observes action changes made on SDK-owned option objects.
        val revision = offline.revision
        val entries = remember(offline.options, revision) { offline.entries() }
        val matching = entries.filter { (key, entry) -> query.isBlank() || "$key ${entry.id} ${entry.language} ${entry.codecs}".contains(query, ignoreCase = true) }
        if (entries.isEmpty()) Text("No options received yet.", style = MaterialTheme.typography.bodySmall)
        matching.take(32).forEach { (key, entry) ->
            Text(key, style = MaterialTheme.typography.labelLarge)
            SelectionContainer { Text(apiValue(offlineEntrySummary(entry)), style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("offline-option-$key")) }
            listOf(null, OfflineOptionEntryAction.Download, OfflineOptionEntryAction.Delete).forEach { action ->
                Button(onClick = { run { offline.setAction(key, action) } }, modifier = Modifier.testTag("offline-action-$key-${action?.name ?: "None"}")) { Text(action?.name ?: "None") }
            }
        }
        if (matching.size > 32) Text("More tracks match. Narrow the search to inspect the remaining entries.", style = MaterialTheme.typography.bodySmall)
        Button(onClick = { run { offline.process() } }, enabled = offline.options != null, modifier = Modifier.testTag("offline-process")) { Text("Process selected actions") }
        Button(onClick = { run { offline.requireManager().suspend() } }, enabled = offline.manager != null, modifier = Modifier.testTag("offline-suspend")) { Text("Suspend") }
        Button(onClick = { run { offline.requireManager().resume() } }, enabled = offline.manager != null, modifier = Modifier.testTag("offline-resume")) { Text("Resume") }
        Button(onClick = { run { controller.loadOfflineSource(requireNotNull(offline.requireManager().offlineSourceConfig)) } }, enabled = offline.manager != null, modifier = Modifier.testTag("offline-play")) { Text("Play downloaded source") }
        Button(onClick = { run { offline.requireManager().deleteAll() } }, enabled = offline.manager != null, modifier = Modifier.testTag("offline-delete")) { Text("Delete all content for this ID") }
        Button(onClick = { run { offline.requireManager().downloadLicense() } }, enabled = offline.manager != null) { Text("Download offline DRM license") }
        Button(onClick = { run { offline.requireManager().renewOfflineLicense() } }, enabled = offline.manager != null) { Text("Renew offline DRM license") }
        Button(onClick = { run { offline.requireManager().releaseLicense() } }, enabled = offline.manager != null) { Text("Release offline DRM license") }
        Button(onClick = { run { offline.releaseManager() } }, enabled = offline.manager != null, modifier = Modifier.testTag("offline-release")) { Text("Release manager") }
        Button(onClick = { run {
            val manager = offline.requireManager()
            val license = runCatching { manager.remainingOfflineLicenseDuration }.getOrNull()
            val source = manager.offlineSourceConfig
            mapOf("usedStorage" to manager.usedStorage, "offlineSourceConfig" to source?.let { mapOf("type" to it.type, "isRestrictToOffline" to it.isRestrictToOffline, "drmIdBytes" to it.drmId?.size) },
                "licenseDuration" to license?.licenseDuration, "playbackDuration" to license?.playbackDuration)
        } }, enabled = offline.manager != null, modifier = Modifier.testTag("offline-state")) { Text("Read offline SDK state") }
        Text(offline.status, modifier = Modifier.testTag("offline-status"), style = MaterialTheme.typography.bodySmall)
        Text("Progress: ${offline.progress}%", style = MaterialTheme.typography.bodySmall)
        SelectionContainer { Text(result, modifier = Modifier.testTag("offline-result"), style = MaterialTheme.typography.bodySmall) }
    }
}
