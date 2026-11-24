package com.playerlab.sportsstreaming

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playerlab.sportsstreaming.core.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun SportsScreen(
    state: PlaybackUiState, session: PlaybackSession, surface: PlayerSurfaceHost,
    fullscreen: Boolean, pictureInPicture: Boolean, controlsFocus: FocusRequester, onFullscreen: () -> Unit, onPip: (() -> Unit)?,
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
    val television = LocalContext.current.isTelevision
    val catalogFocus = remember { FocusRequester() }
    val safeMargin = if (television && !fullscreen && !pictureInPicture)
        Modifier.padding(horizontal = 32.dp, vertical = 16.dp) else Modifier
    Scaffold(modifier = safeMargin, topBar = {
        if (!fullscreen && !pictureInPicture) TopAppBar(title = {
            Text(state.selectedEvent?.localizedTitle(japanese) ?: stringResource(R.string.app_name),
                maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge)
        }, actions = {
            if (session.player.config.remoteControlConfig.isCastEnabled) IconButton(enabled = state.canControlPlayback || state.castConnection != CastConnection.DISCONNECTED || session.player.isCasting, onClick = {
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
            val wide = television || maxWidth >= 700.dp
            val panel: @Composable (Modifier) -> Unit = { modifier ->
                PlayerPanel(state, session, surface, modifier, fullscreen || pictureInPicture,
                    pictureInPicture, wide, controlsFocus, catalogFocus.takeIf { television && !fullscreen && !pictureInPicture },
                    onFullscreen, onPip, { captions = true }, { speed = true })
            }
            if (wide && !fullscreen && !pictureInPicture) {
                Row(Modifier.fillMaxSize().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column(Modifier.weight(1.7f).fillMaxHeight()) {
                        panel(Modifier.weight(1f).fillMaxWidth())
                        EventContinuationPanel(state, session)
                        PlaybackNotice(state, session)
                    }
                    MediaBrowser(state, session, japanese, Modifier.weight(1f).fillMaxHeight(), catalogFocus)
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
