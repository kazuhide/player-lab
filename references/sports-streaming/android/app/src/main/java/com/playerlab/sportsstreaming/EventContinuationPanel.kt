package com.playerlab.sportsstreaming

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.playerlab.sportsstreaming.core.*

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun EventContinuationPanel(state: PlaybackUiState, session: PlaybackSession) {
    val event = state.selectedEvent ?: return
    val asset = state.activeAsset ?: return
    var options by remember { mutableStateOf(false) }
    if (asset.kind == AssetKind.CLIP && event.status == EventStatus.LIVE) FlowRow(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledTonalButton(onClick = { session.returnToLive(false) }, enabled = state.acceptsPlaybackCommands) {
            Text(stringResource(R.string.return_live))
        }
        if (state.canReturnOriginal) OutlinedButton(onClick = { session.returnToLive(true) }, enabled = state.acceptsPlaybackCommands) {
            Text(stringResource(R.string.return_original))
        }
    }
    if (asset.kind == AssetKind.LIVE && event.status == EventStatus.ENDED) Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(archiveLabel(event.archiveStatus)), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = { if (event.archiveStatus == ArchiveStatus.READY) options = true else session.refreshStatus() }) {
            Text(stringResource(if (event.archiveStatus == ArchiveStatus.READY) R.string.archives else R.string.refresh))
        }
    }
    if (options) ArchiveOptionsDialog(state, session) { options = false }
}

@Composable internal fun ArchiveOptionsDialog(state: PlaybackUiState, session: PlaybackSession, onClose: () -> Unit) {
    val event = state.selectedEvent ?: return
    val japanese = LocalConfiguration.current.locales[0].language == "ja"
    var archiveMenu by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = onClose, title = { Text(stringResource(R.string.archives)) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(archiveLabel(event.archiveStatus)))
            if (event.archiveStatus == ArchiveStatus.READY) {
                val archives = state.catalog?.assets.orEmpty().filter { it.kind == AssetKind.ARCHIVE && it.eventId == event.id }
                val target = state.catalog?.asset(state.archiveTargetId ?: event.archiveAssetId)
                if (archives.size > 1) Box {
                    OutlinedButton(onClick = { archiveMenu = true }) { Text(target?.localizedTitle(japanese) ?: stringResource(R.string.archives)) }
                    DropdownMenu(archiveMenu, { archiveMenu = false }) {
                        archives.forEach { archive -> DropdownMenuItem(text = { Text(archive.localizedTitle(japanese)) },
                            onClick = { session.setArchiveTarget(archive.id); archiveMenu = false }) }
                    }
                }
                Text(if (state.archivePosition is ArchivePosition.Available) formatDuration(state.archivePosition.positionMs)
                    else stringResource(if (state.archivePosition == ArchivePosition.End) R.string.archive_at_end else R.string.position_unknown))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(state.autoContinue, session::setAutoContinue)
                Text(stringResource(R.string.auto_continue))
            }
        } }, confirmButton = { Column {
            if (event.archiveStatus == ArchiveStatus.READY) {
                if (state.archivePosition is ArchivePosition.Available) TextButton(onClick = { session.continueInArchive(); onClose() },
                    enabled = state.acceptsPlaybackCommands) { Text(stringResource(R.string.continue_archive)) }
                TextButton(onClick = { session.continueInArchive(true); onClose() }, enabled = state.acceptsPlaybackCommands) {
                    Text(stringResource(R.string.start_archive))
                }
            } else TextButton(onClick = session::refreshStatus) { Text(stringResource(R.string.refresh)) }
        } }, dismissButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.close)) } })
}
private fun archiveLabel(status: ArchiveStatus) = when (status) {
    ArchiveStatus.NOT_READY -> R.string.archive_not_ready
    ArchiveStatus.PROCESSING -> R.string.archive_processing
    ArchiveStatus.READY -> R.string.archive_ready
    ArchiveStatus.FAILED -> R.string.archive_failed
}
