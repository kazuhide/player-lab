package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ReceiverQueueReadinessTest {
    @Test fun stoppedReceiverWithMissingCachedHeadCannotDispatchAnotherSdkLoad() {
        assertFalse(ReceiverQueueReadiness(1, false, null).permitsLoad)
    }
    @Test fun emptyQueueAndKnownDifferentOldSourceCanDispatch() {
        assertTrue(ReceiverQueueReadiness(0, false, null).permitsLoad)
        assertTrue(ReceiverQueueReadiness(1, true, false).permitsLoad)
    }
    @Test fun retainedSameUrlOrUnknownContentMustNotDeduplicateTheNewRequest() {
        assertFalse(ReceiverQueueReadiness(1, true, true).permitsLoad)
        assertFalse(ReceiverQueueReadiness(1, true, null).permitsLoad)
        assertFalse(ReceiverQueueReadiness(-1, false, null).permitsLoad)
        assertFalse(ReceiverQueueReadiness(2, true, false).permitsLoad)
    }
}
