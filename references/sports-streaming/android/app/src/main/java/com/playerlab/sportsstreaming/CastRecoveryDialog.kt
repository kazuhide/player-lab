package com.playerlab.sportsstreaming

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.playerlab.sportsstreaming.core.AssetKind

@Composable internal fun CastRecoveryDialog(state: PlaybackUiState, session: PlaybackSession) {
    AlertDialog(onDismissRequest = {}, title = { Text(stringResource(R.string.receiver_disconnected)) },
        text = { Text(session.receiverRecoveryPositionMs()?.let { stringResource(R.string.position) + " " + formatDuration(it) }
            ?: stringResource(R.string.position_unknown)) },
        confirmButton = { Column {
            if (session.canResumeReceiverPosition()) TextButton(onClick = { session.recoverLocally(true) }) {
                Text(stringResource(R.string.resume_local))
            }
            TextButton(onClick = { session.recoverLocally(false) }) {
                Text(stringResource(if (state.activeAsset?.kind == AssetKind.LIVE) R.string.go_live else R.string.play_from_start))
            }
        } }, dismissButton = { TextButton(onClick = session::keepLocalPaused) { Text(stringResource(R.string.keep_paused)) } })
}
