package com.playerlab.sportsstreaming

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.analytics.AnalyticsApi

@Composable internal fun DiagnosticsDialog(session: PlaybackSession, state: PlaybackUiState, onClose: () -> Unit) {
    val snapshot = session.snapshot()
    val unavailable = stringResource(R.string.not_available)
    AlertDialog(onDismissRequest = onClose, title = { Text(stringResource(R.string.diagnostics)) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DiagnosticValue(stringResource(R.string.player_version), Player.sdkVersion)
            DiagnosticValue(stringResource(R.string.analytics_version), AnalyticsApi.version)
            DiagnosticValue(stringResource(R.string.source), state.activeAssetId ?: unavailable)
            DiagnosticValue(stringResource(R.string.player_identity), System.identityHashCode(snapshot.player).toString())
            DiagnosticValue(stringResource(R.string.source_identity), snapshot.source?.let { System.identityHashCode(it).toString() } ?: unavailable)
            DiagnosticValue(stringResource(R.string.impression), snapshot.impressionId ?: unavailable)
            DiagnosticValue(stringResource(R.string.load_count), snapshot.loadCount.toString())
            DiagnosticValue(stringResource(R.string.position), state.positionMs?.let(::formatDuration) ?: unavailable)
            Text(stringResource(if (BuildConfig.ANALYTICS_LICENSE_KEY.isBlank()) R.string.analytics_unconfigured else R.string.analytics_configured))
            Text(stringResource(R.string.receiver_qoe_unavailable))
            HorizontalDivider()
            Text(stringResource(R.string.recent_events), style = MaterialTheme.typography.titleSmall)
            session.diagnostics.entries.asReversed().take(30).forEach {
                Text("${it.event}\n${it.detail}", style = MaterialTheme.typography.bodySmall)
            }
        } }, confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.close)) } })
}
@Composable private fun DiagnosticValue(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable internal fun PlaybackNotice(state: PlaybackUiState, session: PlaybackSession) {
    if (state.notice == PlaybackNotice.NONE) return
    val text = when (state.notice) {
        PlaybackNotice.NONE -> ""
        PlaybackNotice.CATALOG_OFFLINE -> stringResource(R.string.catalog_offline)
        PlaybackNotice.CATALOG_FAILED -> stringResource(R.string.catalog_failed)
        PlaybackNotice.LICENSE_MISSING -> stringResource(R.string.license_missing)
        PlaybackNotice.MEDIA_FAILED -> state.errorCode?.let { stringResource(R.string.media_failed, it) }
            ?: stringResource(R.string.media_failed_unknown)
        PlaybackNotice.STATUS_FAILED -> stringResource(R.string.status_failed)
        PlaybackNotice.POSITION_UNKNOWN -> stringResource(R.string.position_unknown)
        PlaybackNotice.POSITION_EXPIRED -> stringResource(R.string.position_expired)
        PlaybackNotice.CAST_MEDIA_UNREACHABLE -> stringResource(R.string.cast_media_unreachable)
        PlaybackNotice.CAST_FAILED -> stringResource(R.string.cast_failed)
    }
    Surface(color = MaterialTheme.colorScheme.errorContainer) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
            TextButton(onClick = {
                when (state.notice) {
                    PlaybackNotice.CATALOG_FAILED, PlaybackNotice.CATALOG_OFFLINE -> session.reloadCatalog()
                    PlaybackNotice.STATUS_FAILED -> session.refreshStatus()
                    PlaybackNotice.MEDIA_FAILED -> state.activeAssetId?.let { session.selectAsset(it) }
                    else -> session.clearNotice()
                }
            }) { Text(stringResource(R.string.retry)) }
        }
    }
}
