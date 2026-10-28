package com.playerlab.sportsstreaming

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

/** Requires a fresh short event and one explicitly authorized real receiver. */
@RunWith(AndroidJUnit4::class)
class UnknownReceiverMappingTest {
    @Test fun unverifiedUtcPreservesTheSourceUntilAnExplicitArchiveStart() {
        CastPlaybackTest().runReceiverSequence(unknownMappingRecovery = true)
    }
}
