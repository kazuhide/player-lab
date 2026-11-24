package com.playerlab.sportsstreaming

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playerlab.sportsstreaming.core.*
import java.util.Locale

@Composable internal fun MediaBrowser(state: PlaybackUiState, session: PlaybackSession, japanese: Boolean, modifier: Modifier) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
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
                    enabled = state.acceptsPlaybackCommands && event.liveAssetId != null && event.status in setOf(EventStatus.LIVE, EventStatus.ENDED),
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
    var focused by remember { mutableStateOf(false) }
    Surface(onClick = onClick, enabled = enabled,
        modifier = Modifier.onFocusChanged { focused = it.isFocused },
        border = if (focused) BorderStroke(3.dp, MaterialTheme.colorScheme.primary) else null,
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
