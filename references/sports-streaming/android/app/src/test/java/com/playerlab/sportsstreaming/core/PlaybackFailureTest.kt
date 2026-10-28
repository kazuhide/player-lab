package com.playerlab.sportsstreaming.core

import com.playerlab.sportsstreaming.PlaybackNotice
import com.playerlab.sportsstreaming.PlaybackUiState
import org.junit.Assert.*
import org.junit.Test

class PlaybackFailureTest {
    @Test fun appReceiverFailureDisablesControlsWithoutInventingAnSdkErrorCode() {
        val failed = PlaybackUiState(activeAssetId = "clip-a", loadingSource = false,
            sourceFailed = true, notice = PlaybackNotice.MEDIA_FAILED)
        assertNull(failed.errorCode)
        assertFalse(failed.canControlPlayback)
        assertFalse(failed.copy(notice = PlaybackNotice.NONE).canControlPlayback)
    }
    @Test fun newSourceLoadClearsTheFailureButStaysUnavailableUntilLoaded() {
        val failed = PlaybackUiState(activeAssetId = "clip-a", sourceFailed = true)
        val retry = failed.copy(sourceFailed = false, loadingSource = true)
        assertFalse(retry.canControlPlayback)
        assertTrue(retry.copy(loadingSource = false).canControlPlayback)
    }
}
