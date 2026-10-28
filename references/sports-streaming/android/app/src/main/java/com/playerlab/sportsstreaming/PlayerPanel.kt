package com.playerlab.sportsstreaming

import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun PlayerPanel(
    state: PlaybackUiState, session: PlaybackSession, surface: PlayerSurfaceHost, modifier: Modifier,
    expanded: Boolean, pictureInPicture: Boolean, boundedHeight: Boolean, onFullscreen: () -> Unit, onPip: () -> Unit,
    onCaptions: () -> Unit, onSpeed: () -> Unit,
) {
    val backLabel = stringResource(R.string.back_15)
    val forwardLabel = stringResource(R.string.forward_15)
    val loadingLabel = stringResource(R.string.loading_source)
    Column(modifier) {
        if (!pictureInPicture) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                    listOf(R.string.standard_ui, R.string.sports_ui).forEachIndexed { index, label ->
                        SegmentedButton(selected = state.sportsUi == (index == 1), onClick = { session.setSportsUi(index == 1) },
                            modifier = Modifier.heightIn(min = 48.dp), shape = SegmentedButtonDefaults.itemShape(index, 2),
                            label = { Text(stringResource(label), maxLines = 1) })
                    }
                }
                TextButton(onClick = { session.setProtocol(if (state.protocol == com.playerlab.sportsstreaming.core.StreamProtocol.HLS)
                    com.playerlab.sportsstreaming.core.StreamProtocol.DASH else com.playerlab.sportsstreaming.core.StreamProtocol.HLS) },
                    enabled = state.acceptsPlaybackCommands, modifier = Modifier.heightIn(min = 48.dp)) { Text(state.protocol.name) }
            }
        }
        Box(if (expanded || boundedHeight) Modifier.weight(1f).fillMaxWidth().background(Color.Black)
            else Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black)) {
            AndroidView(factory = {
                (surface.parent as? ViewGroup)?.removeView(surface)
                surface
            }, update = { it.showUi(state.sportsUi) }, modifier = Modifier.fillMaxSize())
            if (state.loadingSource) CircularProgressIndicator(Modifier.align(Alignment.Center).semantics { contentDescription = loadingLabel }, color = Color.White)
        }
        if (pictureInPicture) return@Column
        if (state.sportsUi) {
            Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = session::togglePlayback, enabled = state.canControlPlayback) {
                    Icon(if (state.isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                        stringResource(if (state.isPlaying) R.string.pause else R.string.play))
                }
                Text(state.positionMs?.let(::formatDuration) ?: "--:--:--", style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f))
                IconButton(onClick = { session.seekBy(-15.0) }, enabled = state.canSeekBack, modifier = Modifier.semantics { contentDescription = backLabel }) {
                    Text("−15", style = MaterialTheme.typography.labelLarge)
                }
                IconButton(onClick = { session.seekBy(15.0) }, enabled = state.canSeekForward, modifier = Modifier.semantics { contentDescription = forwardLabel }) {
                    Text("+15", style = MaterialTheme.typography.labelLarge)
                }
                if (boundedHeight) PlaybackOptions(state.canControlPlayback, onCaptions, onSpeed, onPip)
                IconButton(onClick = onFullscreen) { Icon(if (expanded) Icons.Outlined.FullscreenExit else Icons.Outlined.Fullscreen,
                    stringResource(if (expanded) R.string.exit_fullscreen else R.string.fullscreen)) }
            }
            if (!boundedHeight) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                PlaybackOptions(state.canControlPlayback, onCaptions, onSpeed, onPip)
            }
        }
        if (!boundedHeight && state.castConnection == com.playerlab.sportsstreaming.core.CastConnection.DISCONNECTED && state.activeAssetId != null) {
            Text(stringResource(R.string.this_device), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        if (state.castConnection != com.playerlab.sportsstreaming.core.CastConnection.DISCONNECTED) Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.CastConnected, null, modifier = Modifier.size(18.dp))
            Text(state.castName ?: stringResource(when (state.castConnection) {
                com.playerlab.sportsstreaming.core.CastConnection.CONNECTING -> R.string.connecting
                com.playerlab.sportsstreaming.core.CastConnection.RECONNECTING -> R.string.reconnecting
                else -> R.string.connected
            }), style = MaterialTheme.typography.bodyMedium)
        }
        if (state.isLive) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val behind = (-state.timeShiftSeconds).coerceIn(0.0, Int.MAX_VALUE.toDouble()).toInt()
            Text(if (state.timeShiftSeconds < -2) pluralStringResource(R.plurals.behind_live, behind, behind)
                else stringResource(R.string.live), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            FilledTonalButton(onClick = session::goLive, enabled = state.canControlPlayback && state.timeShiftSeconds < -0.5) { Text(stringResource(R.string.go_live)) }
        }
    }
}

@Composable private fun PlaybackOptions(enabled: Boolean, onCaptions: () -> Unit, onSpeed: () -> Unit, onPip: () -> Unit) {
    TextButton(onClick = onCaptions, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.subtitles)) }
    TextButton(onClick = onSpeed, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.speed)) }
    IconButton(onClick = onPip, enabled = enabled) { Icon(Icons.Outlined.PictureInPictureAlt, stringResource(R.string.pip)) }
}
