package com.playerlab.sportsstreaming

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.playerlab.sportsstreaming.core.*
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun SportsScreen(
    state: PlaybackUiState, session: PlaybackSession, surface: PlayerSurfaceHost,
    fullscreen: Boolean, pictureInPicture: Boolean, onFullscreen: () -> Unit, onPip: () -> Unit,
    onCast: () -> Unit, onExport: () -> Unit, onAnalytics: () -> Unit, onDashboard: () -> Unit,
    onLanguage: (String) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    var castControls by remember { mutableStateOf(false) }
    var archiveControls by remember { mutableStateOf(false) }
    var diagnostics by remember { mutableStateOf(false) }
    var captions by remember { mutableStateOf(false) }
    var speed by remember { mutableStateOf(false) }
    val japanese = LocalConfiguration.current.locales[0].language == "ja"
    Scaffold(topBar = {
        if (!fullscreen && !pictureInPicture) TopAppBar(title = {
            Text(state.selectedEvent?.localizedTitle(japanese) ?: stringResource(R.string.app_name),
                maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge)
        }, actions = {
            IconButton(enabled = state.canControlPlayback || state.castConnection != CastConnection.DISCONNECTED || session.player.isCasting, onClick = {
                if (state.castConnection != CastConnection.DISCONNECTED || session.player.isCasting) castControls = true else onCast()
            }) { Icon(Icons.Outlined.Cast, stringResource(R.string.cast)) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, stringResource(R.string.options)) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.refresh)) }, onClick = { menu = false; session.reloadCatalog() })
                    if (state.activeAsset?.kind == AssetKind.LIVE) DropdownMenuItem(
                        text = { Text(stringResource(R.string.archives)) }, onClick = { menu = false; archiveControls = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.diagnostics)) }, onClick = { menu = false; diagnostics = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.export_records)) }, onClick = { menu = false; onExport() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.analytics)) }, onClick = { menu = false; onAnalytics() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.dashboard)) }, onClick = { menu = false; onDashboard() })
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text(stringResource(R.string.english)) }, onClick = { menu = false; onLanguage("en") })
                    DropdownMenuItem(text = { Text(stringResource(R.string.japanese)) }, onClick = { menu = false; onLanguage("ja") })
                }
            }
        })
    }) { padding ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val wide = maxWidth >= 700.dp
            val panel: @Composable (Modifier) -> Unit = { modifier ->
                PlayerPanel(state, session, surface, modifier, fullscreen || pictureInPicture,
                    pictureInPicture, wide, onFullscreen, onPip, { captions = true }, { speed = true })
            }
            if (wide && !fullscreen && !pictureInPicture) {
                Row(Modifier.fillMaxSize().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column(Modifier.weight(1.7f).fillMaxHeight()) {
                        panel(Modifier.weight(1f).fillMaxWidth())
                        EventContinuationPanel(state, session)
                        PlaybackNotice(state, session)
                    }
                    MediaBrowser(state, session, japanese, Modifier.weight(1f).fillMaxHeight())
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    panel(if (fullscreen || pictureInPicture) Modifier.weight(1f) else Modifier.fillMaxWidth())
                    if (!fullscreen && !pictureInPicture) {
                        EventContinuationPanel(state, session)
                        PlaybackNotice(state, session)
                        MediaBrowser(state, session, japanese, Modifier.weight(1f))
                    }
                }
            }
        }
    }
    if (castControls) AlertDialog(onDismissRequest = { castControls = false },
        title = { Text(state.castName ?: stringResource(R.string.cast)) },
        confirmButton = { TextButton(onClick = { castControls = false; onCast() }) { Text(stringResource(R.string.disconnect)) } },
        dismissButton = { TextButton(onClick = { castControls = false }) { Text(stringResource(R.string.close)) } })
    if (archiveControls) ArchiveOptionsDialog(state, session) { archiveControls = false }
    if (state.needsLocalReturnChoice) CastRecoveryDialog(state, session)
    if (diagnostics) DiagnosticsDialog(session, state) { diagnostics = false }
    if (captions) {
        val tracks = session.player.source?.availableSubtitleTracks.orEmpty()
        AlertDialog(onDismissRequest = { captions = false }, title = { Text(stringResource(R.string.subtitles)) },
            text = { Column {
                tracks.forEach { track -> TextButton(onClick = { session.setSubtitle(track.id); captions = false }) {
                    Text(if (track.id == "off") stringResource(R.string.off) else track.label ?: track.language ?: track.id)
                } }
                if (tracks.isEmpty()) Text(stringResource(R.string.not_available))
            } }, confirmButton = { TextButton(onClick = { captions = false }) { Text(stringResource(R.string.close)) } })
    }
    if (speed) AlertDialog(onDismissRequest = { speed = false }, title = { Text(stringResource(R.string.speed)) },
        text = { Row { listOf(0.5f, 1f, 1.5f, 2f).forEach { value ->
            TextButton(onClick = { session.setSpeed(value); speed = false }) { Text("${value}×") }
        } } }, confirmButton = { TextButton(onClick = { speed = false }) { Text(stringResource(R.string.close)) } })
}

@Composable private fun MediaBrowser(state: PlaybackUiState, session: PlaybackSession, japanese: Boolean, modifier: Modifier) {
    var tab by remember { mutableIntStateOf(0) }
    val catalog = state.catalog
    val loadingLabel = stringResource(R.string.loading_catalog)
    Column(modifier) {
        TabRow(tab) {
            listOf(R.string.live, R.string.clips, R.string.archives).forEachIndexed { index, label ->
                Tab(tab == index, onClick = { tab = index }, text = { Text(stringResource(label), maxLines = 1) })
            }
        }
        if (state.loadingCatalog) LinearProgressIndicator(Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel })
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
            if (tab == 0) items(catalog?.events.orEmpty(), key = { it.id }) { event ->
                MediaRow(event.localizedTitle(japanese), eventStateLabel(event.status),
                    event.liveAssetId == state.activeAssetId,
                    enabled = state.acceptsPlaybackCommands && event.status in setOf(EventStatus.LIVE, EventStatus.ENDED),
                    onClick = { event.liveAssetId?.let { session.selectAsset(it) } })
            }
            else {
                val assets = catalog?.assets.orEmpty().filter { asset ->
                    if (tab == 1) asset.kind == AssetKind.CLIP else asset.kind == AssetKind.ARCHIVE &&
                        catalog?.event(asset.eventId)?.archiveStatus == ArchiveStatus.READY
                }
                items(assets, key = { it.id }) { asset ->
                    val duration = asset.durationMs?.let(::formatDuration) ?: stringResource(R.string.not_available)
                    MediaRow(asset.localizedTitle(japanese), duration, asset.id == state.activeAssetId,
                        state.acceptsPlaybackCommands) { session.selectAsset(asset.id) }
                }
                if (assets.isEmpty()) item { Text(stringResource(R.string.no_assets),
                    style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 24.dp)) }
            }
        }
    }
}
@Composable private fun MediaRow(title: String, subtitle: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, enabled = enabled,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.background) {
        Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 80.dp).padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Outlined.PlayCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
@Composable internal fun eventStateLabel(status: EventStatus) = stringResource(when (status) {
    EventStatus.SCHEDULED -> R.string.scheduled; EventStatus.LIVE -> R.string.live
    EventStatus.ENDED -> R.string.event_ended; EventStatus.CANCELLED -> R.string.cancelled
})
internal fun formatDuration(milliseconds: Long): String {
    val total = milliseconds.coerceAtLeast(0) / 1_000
    return String.format(Locale.ROOT, "%02d:%02d:%02d", total / 3_600, total / 60 % 60, total % 60)
}
